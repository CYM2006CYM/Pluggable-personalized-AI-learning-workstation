# RichLesson章节维护视图

> 本文件由`scripts/w6-rich-lessons/generate-rich-lessons.mjs`确定性生成，请修改源Markdown后重新运行脚本。

| 知识点 | 源文件 | SHA-256 | guided/concise/practice中文字数 |
|---|---|---|---|
| `pandas.clean.read-csv` | `01-读取CSV-三版本正文.md` | `f893d9beef780a8cd58117a452e1cdfb1e332961e3f187d22e84e2d4cf376f2d` | 2998 / 2404 / 2353 |
| `pandas.clean.inspect-dataframe` | `02-检查DataFrame结构-三版本正文.md` | `93c4a15334920ebdea8a65712af81ad46d8b06208e5ba2fb99bbfe9624155ee3` | 2205 / 2316 / 2436 |
| `pandas.clean.missing-values` | `03-处理缺失值-三版本正文.md` | `d115a5abc4496c3396d668a2104ae3966ff52a6f9db7848b9fba6319227715fc` | 2402 / 2004 / 2118 |
| `pandas.clean.duplicate-orders` | `04-处理重复订单-三版本正文.md` | `fc196103bd02f4c48fb1ef7797ec36a09d6fe8dd5f2c17b3a0abe8dd20c6897a` | 2430 / 2004 / 2005 |
| `pandas.clean.type-format` | `05-规范类型与格式-三版本正文.md` | `1999644494ff7b405ef65363aa7e08a1fe3e2328b2d2acee4e82ead9719bcd3c` | 2273 / 2010 / 2006 |
| `pandas.clean.validate-result` | `06-验证清洗结果-三版本正文.md` | `3efc64f318ca828b35d94e0763b02c6176aaca5bf70c4540d5f620b209392670` | 2205 / 2005 / 2008 |

## 规则与来源

### pandas.clean.read-csv

- canonical rules：`READ-01`、`READ-02`、`READ-03`、`READ-04`、`READ-05`
- source anchors：`src-pandas-read-csv`

### pandas.clean.inspect-dataframe

- canonical rules：`INSPECT-01`、`INSPECT-02`、`INSPECT-03`、`INSPECT-04`、`INSPECT-05`
- source anchors：`src-pandas-dtypes`

### pandas.clean.missing-values

- canonical rules：`MISS-01`、`MISS-02`、`MISS-03`、`MISS-04`、`MISS-05`
- source anchors：`src-pandas-missing-data`

### pandas.clean.duplicate-orders

- canonical rules：`DUP-01`、`DUP-02`、`DUP-03`、`DUP-04`、`DUP-05`
- source anchors：`src-pandas-duplicates`、`src-pandas-sort-values`

### pandas.clean.type-format

- canonical rules：`TYPE-01`、`TYPE-02`、`TYPE-03`、`TYPE-04`、`TYPE-05`
- source anchors：`src-pandas-to-numeric`、`src-pandas-to-datetime`、`src-pandas-string`

### pandas.clean.validate-result

- canonical rules：`VALID-01`、`VALID-02`、`VALID-03`、`VALID-04`、`VALID-05`、`VALID-06`
- source anchors：`src-pandas-testing`、`src-python-security`
