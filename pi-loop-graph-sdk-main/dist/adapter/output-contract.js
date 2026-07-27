import { createHash } from "node:crypto";
import Schema from "typebox/schema";
export const DEFAULT_OUTPUT_CONTRACT_MAX_BYTES = 64 * 1024;
export const OUTPUT_CONTRACT_MESSAGE_TYPE = "loop_graph_output_contract";
export function prepareOutputContract(schema, maxBytes = DEFAULT_OUTPUT_CONTRACT_MAX_BYTES) {
    if (schema == null)
        return null;
    if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
        throw new TypeError(`outputContractMaxBytes 必须是正整数，收到: ${String(maxBytes)}`);
    }
    const normalized = normalizeJsonValue(schema, "$", new Set());
    const serialized = JSON.stringify(normalized, null, 2);
    const bytes = Buffer.byteLength(serialized, "utf8");
    if (bytes > maxBytes) {
        throw new Error(`outputSchema 序列化后为 ${bytes} bytes，超过 outputContractMaxBytes (${maxBytes})`);
    }
    const validator = Schema.Compile(normalized);
    const fingerprint = createHash("sha256").update(serialized).digest("hex");
    return Object.freeze({
        schema: deepFreeze(normalized),
        serialized,
        fingerprint,
        byteSize: bytes,
        modelText: [
            "=== OUTPUT CONTRACT ===",
            "提交到 __graph_complete__.result 的值必须严格符合以下 JSON Schema：",
            serialized,
            "=== END OUTPUT CONTRACT ===",
        ].join("\n"),
        validate(result) {
            const [isValid, errors] = validator.Errors(result);
            if (isValid)
                return { isValid: true };
            const summary = errors.slice(0, 5).map((error) => {
                const path = error.instancePath || "$";
                return `${path} ${error.message}`;
            }).join("; ");
            return { isValid: false, reason: `输出不符合 outputSchema: ${summary}` };
        },
    });
}
function normalizeJsonValue(value, path, ancestors) {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return value;
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new TypeError(`${path} 包含非有限数字`);
        return value;
    }
    if (typeof value !== "object") {
        throw new TypeError(`${path} 包含不可序列化的 ${typeof value}`);
    }
    if (ancestors.has(value))
        throw new TypeError(`${path} 包含循环引用`);
    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            if (Object.keys(value).length !== value.length) {
                throw new TypeError(`${path} 包含稀疏数组或非索引属性`);
            }
            return value.map((entry, index) => normalizeJsonValue(entry, `${path}[${index}]`, ancestors));
        }
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError(`${path} 必须是普通 JSON 对象`);
        }
        if (Object.getOwnPropertySymbols(value).length > 0) {
            throw new TypeError(`${path} 包含 JSON 无法表示的 symbol key`);
        }
        const output = {};
        for (const key of Object.keys(value).sort()) {
            output[key] = normalizeJsonValue(value[key], `${path}.${key}`, ancestors);
        }
        return output;
    }
    finally {
        ancestors.delete(value);
    }
}
function deepFreeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value))
            deepFreeze(child);
    }
    return value;
}
