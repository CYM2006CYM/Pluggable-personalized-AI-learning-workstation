export function isJsonValue(value) {
    return isJsonValueInternal(value, new WeakSet());
}
function isJsonValueInternal(value, ancestors) {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return true;
    if (typeof value === "number")
        return Number.isFinite(value);
    if (typeof value !== "object")
        return false;
    if (ancestors.has(value))
        return false;
    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            if (Object.getOwnPropertySymbols(value).length > 0)
                return false;
            if (Object.getOwnPropertyNames(value).length !== value.length + 1)
                return false;
            for (let index = 0; index < value.length; index += 1) {
                if (!Object.hasOwn(value, index) || !isJsonValueInternal(value[index], ancestors))
                    return false;
            }
            return true;
        }
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null)
            return false;
        if (Object.getOwnPropertySymbols(value).length > 0)
            return false;
        const descriptors = Object.getOwnPropertyDescriptors(value);
        for (const descriptor of Object.values(descriptors)) {
            if (!descriptor.enumerable || !("value" in descriptor))
                return false;
            if (!isJsonValueInternal(descriptor.value, ancestors))
                return false;
        }
        return true;
    }
    catch {
        return false;
    }
    finally {
        ancestors.delete(value);
    }
}
