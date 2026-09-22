# ⚡ ElectroLab AI

> 结合人工智能与物理化学定量计算的专业电化学分析平台

ElectroLab AI 面向电化学科研场景，支持 **CV（循环伏安）**、**GCD（恒流充放电）**、**EIS（交流阻抗）** 三类核心实验数据的智能拟合、特征提取与结构化报告生成。上传原始数据文件或曲线截图，即可在数秒内获得一份物理化学依据扎实的深度分析报告。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-6-646cff?logo=vite&logoColor=white)](https://vite.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-38bdf8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)

---

## ✨ 核心功能

### 📊 多协议数据解析

- 支持 **CV / GCD / EIS** 三类电化学数据，上传后自动识别实验类型
- 兼容逗号、空格、Tab 等多种分隔符的 TXT / CSV 数据文件，自动跳过表头
- 自动提取扫描速率、放电电流等实验参数

### 🧮 物理化学定量计算

不是"看图说话"，而是先做真实计算再让 AI 解读：

- **CV**：氧化 / 还原峰值提取，结合电极面积推算最大峰值电流密度（mA/cm²）
- **GCD**：由放电时间与电压窗口估算比电容（F/g）与比容量（mAh/g）
- **EIS**：Nyquist 图外推估算欧姆内阻 Rs 与界面电荷转移阻抗 Rct

### 🤖 AI 深度分析报告

- 单品深度拟合分析 + 一键批量拟合
- 支持直接上传**曲线图像**进行 AI 视觉解析（需多模态模型）
- 报告采用固定结构化模板：实验条件大纲 → 定量指标 → 机理探讨，杜绝 AI 废话
- **多样品横向联合比对**（最多 6 组），自动高亮差值与提升幅度，排序并解释改性机理

### 🔌 灵活的模型接入

- 默认使用 Google Gemini API（服务端 `GEMINI_API_KEY`）
- 支持**自定义 API**：DeepSeek、OpenAI 及各类中转站，粘贴 JSON 配置或 `key=value` 文本即可自动解析出 Base URL / 模型名 / Key
- 常见错误（401 / 404 / 429 / 纯文本模型误传图像）均有中文引导式报错

### 🗂️ 项目归档与导出

- 多项目分类管理，分析报告一键归档，数据本地存储
- 比对中心：跨项目勾选样品，合并曲线对比
- 导出标准 CSV，可直接导入 **Origin / Excel** 二次绘图

---

## 🚀 快速开始

### 环境要求

- Node.js ≥ 18（推荐 20+）
- npm 或 bun

### 安装与启动

```bash
# 克隆仓库
git clone https://github.com/yp1767134800-star/ElectroLab.git
cd ElectroLab

# 安装依赖
npm install

# 配置环境变量（可选，也可在界面中配置自定义 API）
cp .env.example .env
# 编辑 .env，填入你的 GEMINI_API_KEY

# 启动开发服务器（Express + Vite HMR）
npm run dev
```

启动后访问 [http://localhost:3000](http://localhost:3000)。

### 生产构建

```bash
npm run build   # 构建前端 + 打包服务端
npm start       # 启动生产服务
```

### 其他命令

```bash
npm run lint    # TypeScript 类型检查
npm run clean   # 清理构建产物
```

---

## ⚙️ 环境变量

| 变量名 | 必填 | 说明 |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | 否 | Gemini API 密钥。不配置时可在界面侧边栏启用"自定义 API"，填入任意 OpenAI 兼容接口的 Key |
| `APP_URL` | 否 | 应用部署地址（AI Studio / Cloud Run 部署时自动注入） |

> 💡 `.env` 已被 `.gitignore` 排除，请勿将真实密钥提交到仓库。

---

## 🏗️ 技术栈

| 层 | 技术 |
| :--- | :--- |
| 前端 | React 19 · TypeScript · Tailwind CSS 4 · Motion 动效 |
| 图表 | Recharts（曲线渲染、缩放、框选） |
| 数据解析 | Papa Parse（多分隔符鲁棒解析） |
| 报告渲染 | react-markdown + GFM + rehype-raw |
| 服务端 | Express 4（分析代理 + 静态托管） |
| AI | @google/genai（Gemini），兼容任意 OpenAI 协议接口 |
| 构建 | Vite 6 + esbuild + tsx |

---

## 📁 项目结构

```
ElectroLab/
├── index.html            # 前端入口
├── server.ts             # Express 服务端：AI 分析代理 + 定量计算引擎
├── vite.config.ts        # Vite 配置
├── src/
│   ├── main.tsx          # React 挂载入口
│   ├── App.tsx           # 主应用（单品分析 / 批量拟合 / 项目归档 / 比对中心）
│   ├── index.css         # 全局样式
│   └── lib/
│       └── parseData.ts  # 电化学数据解析器
├── .env.example          # 环境变量模板
└── package.json
```

### 服务端 API

| 端点 | 说明 |
| :--- | :--- |
| `POST /api/analyze-data` | 原始数据拟合分析（先做定量计算，再生成 AI 报告） |
| `POST /api/analyze-image` | 曲线图像视觉解析 |
| `POST /api/compare-data` | 多样品横向联合比对报告 |

---

## 🎯 适用场景

- 超级电容器 / 电池材料的 CV、GCD、EIS 数据快速解读
- 材料改性前后的多样品性能横向对比与机理分析
- 组会、论文写作前的结构化数据整理与报告初稿生成
- 教学场景下的电化学实验数据分析演示

---

## 📝 License

本项目基于 [MIT License](https://opensource.org/licenses/MIT) 开源。

---

<p align="center">
  如果这个项目对你的科研有帮助，欢迎点亮 ⭐ Star 支持一下！
</p>
