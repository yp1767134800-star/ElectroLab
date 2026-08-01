import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import * as dotenv from "dotenv";

dotenv.config();

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

function formatGeminiError(error: any): string {
  const errMsg = (error?.message || "") + " " + (typeof error === "object" ? JSON.stringify(error) : "") + " " + String(error);

  // Gemini ADC / Scope Error / Missing API Key or 403
  if (
    errMsg.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") || 
    errMsg.includes("insufficient authentication scopes") ||
    errMsg.includes("PERMISSION_DENIED") ||
    errMsg.includes("403")
  ) {
    return "⚠️ **【API Key 未配置或权限失效】**\n\n" +
           "系统默认 API 密钥未配置或无访问权限。\n\n" +
           "**💡 解决办法：**\n" +
           "1. **推荐**：点击侧边栏 **“启用自定义 API”** 开关，填入您的 API 密钥（如 DeepSeek、OpenAI 或各类中转站 Key），即可开启数据分析与诊断！\n" +
           "2. 或在项目设置 (Settings -> Secrets) 中添加名为 `GEMINI_API_KEY` 的环境变量。";
  }

  // 1. 自定义 API 常见错误拦截与可视化引导
  if (
    errMsg.includes("[自定义 API 错误") || 
    errMsg.includes("image_url") || 
    errMsg.includes("expected text") || 
    errMsg.includes("Failed to deserialize") || 
    errMsg.includes("deserialize")
  ) {
    if (errMsg.includes("HTTP 404") && (errMsg.includes("model") || errMsg.includes("endpoint") || errMsg.includes("exist"))) {
      return "⚠️ **【自定义模型名称错误】** 该供应商接口返回 HTTP 404，表明您填写的模型名称不存在或无访问权限。\n\n" +
             "**💡 解决办法：**\n" +
             "1. 请检查侧边栏的 **“模型名称”** 是否拼写正确（例如：DeepSeek 文本模型应填写为 `deepseek-chat` 而非 `deepseek`）。\n" +
             "2. 或者检查该供应商是否真实支持您请求的接口路径。";
    }

    if (
      errMsg.includes("image_url") || 
      errMsg.includes("expected text") || 
      errMsg.includes("deserialize") ||
      errMsg.includes("Failed to deserialize the JSON body")
    ) {
      return "⚠️ **【自定义模型错误】** 您当前在面板中配置的自定义模型（如 `deepseek-chat` 或其它文本模型）为 **纯文本模型**，不支持直接读取或解析图表图片进行视觉分析（报错：`expected text, unknown variant image_url`）。\n\n" +
             "**💡 解决办法：**\n" +
             "请点击侧边栏的 **“自定义 API”**，在 **“模型名称”** 中填入支持 Vision / 多模态的可用模型名称（例如 `deepseek-vl`、`gpt-4o`、`claude-3-5-sonnet` 等）。";
    }
    if (errMsg.includes("401") || errMsg.includes("Unauthorized") || errMsg.includes("invalid") || errMsg.includes("Bearer")) {
      return "🔑 **【自定义 API 密钥校验失败】** 您的自定义 API 密钥无法通过接口验证（HTTP 401 Unauthorized）。\n\n" +
             "**💡 解决办法：**\n" +
             "1. 请点击侧边栏 **“自定义 API”**，检查并重新填入合法 Key。\n" +
             "2. 确认您的令牌没有因额度不足而过期失效。";
    }
    if (errMsg.includes("404") || errMsg.includes("not found") || errMsg.includes("405")) {
      return "📡 **【自定义 API 路由或模型未找到】** 找不到指定的云端模型名称或 API 接口路径（HTTP 404/405 Not Found）。\n\n" +
             "**💡 解决办法：**\n" +
             "1. **检查 Base URL**：例如 DeepSeek 官方应当是 `https://api.deepseek.com`。\n" +
             "2. **检查模型名称**：确认您的输入与模型厂商标准拼写一致。";
    }
    if (errMsg.includes("429") || errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.includes("rate limit") || errMsg.includes("quota")) {
      return "⏳ **【自定义 API 频次额度超限】** 您的自定义 API 渠道触发了限流或余额不足（HTTP 429）。\n\n" +
             "**💡 解决办法：**\n" +
             "请稍等 1 分钟后重试，或检查您的 API 账户余额。";
    }
    if (
      errMsg.includes("fetch failed") || 
      errMsg.includes("ENOTFOUND") || 
      errMsg.includes("ECONNREFUSED") || 
      errMsg.includes("connect") ||
      errMsg.includes("network")
    ) {
      return "🌐 **【自定义 API 网关连接失败】** 无法连接到您配置的 Base URL。\n\n" +
             "**💡 解决办法：**\n" +
             "请检查 Base URL 是否正确（包括 `http://` 或 `https://` 前缀）。";
    }
  }

  if (errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.includes("Quota exceeded") || errMsg.includes("429")) {
    return "您的 API 请求频次/额度已超限（HTTP 429 RESOURCE_EXHAUSTED）。请稍微等待 1-2 分钟重试。";
  }

  return error?.message || errMsg;
}

interface CustomConfig {
  enabled: boolean;
  apiType: "default" | "openai";
  apiKey: string;
  baseUrl: string;
  model: string;
  imageUseBuiltIn?: boolean;
}

async function uploadImageToGemini(client: GoogleGenAI, imagePart: { data: string; mimeType: string }): Promise<any> {
  const extension = imagePart.mimeType.split("/")[1] || "png";
  const tempFilePath = path.join("/tmp", `electro_upload_${Date.now()}_${Math.random().toString(36).substring(2, 11)}.${extension}`);
  
  // Write the base64 data to a temp file
  fs.writeFileSync(tempFilePath, Buffer.from(imagePart.data, "base64"));
  
  try {
    const uploadResult = await client.files.upload({
      file: tempFilePath,
      config: {
        mimeType: imagePart.mimeType,
      }
    });
    return uploadResult;
  } finally {
    // Clean up the temp file
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    } catch (e) {
      console.error("Failed to delete temp file:", e);
    }
  }
}

async function callModel(options: {
  systemInstruction: string;
  prompt: string;
  imagePart?: { data: string; mimeType: string };
  customConfig?: CustomConfig;
}): Promise<string> {
  const { systemInstruction, prompt, imagePart, customConfig } = options;

  // 1. If Custom API is not enabled, use our default Gemini AI config
  const useBuiltIn = !customConfig || !customConfig.enabled;

  if (useBuiltIn) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("ACCESS_TOKEN_SCOPE_INSUFFICIENT: 默认 API 密钥未配置。请在侧边栏开启“启用自定义 API”并配置您的 API Key。");
    }
    if (imagePart) {
      const uploadResult = await uploadImageToGemini(ai, imagePart);
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          prompt,
          uploadResult
        ],
        config: { systemInstruction }
      });
      return response.text || "";
    } else {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: { systemInstruction }
      });
      return response.text || "";
    }
  }

  // 2. Custom API - OpenAI-Compatible endpoint (DeepSeek, custom gateways, SiliconFlow, OpenAI, etc.)
  let rawBaseUrl = (customConfig.baseUrl || "").trim().replace(/\/$/, "");
  if (!rawBaseUrl) {
    rawBaseUrl = "https://api.openai.com/v1";
  }
    
    // Auto fix common mistyped domain names
    if (rawBaseUrl === "https://deepseek.com" || rawBaseUrl === "http://deepseek.com") {
      rawBaseUrl = "https://api.deepseek.com";
    } else if (rawBaseUrl === "https://openai.com" || rawBaseUrl === "http://openai.com") {
      rawBaseUrl = "https://api.openai.com/v1";
    } else if (rawBaseUrl === "https://siliconflow.cn" || rawBaseUrl === "http://siliconflow.cn") {
      rawBaseUrl = "https://api.siliconflow.cn/v1";
    }

    // Build candidate endpoint URLs to support both /v1/chat/completions and /chat/completions
    const candidateUrls: string[] = [];
    if (rawBaseUrl.endsWith("/chat/completions")) {
      candidateUrls.push(rawBaseUrl);
    } else if (rawBaseUrl.endsWith("/v1")) {
      candidateUrls.push(`${rawBaseUrl}/chat/completions`);
      candidateUrls.push(`${rawBaseUrl.replace(/\/v1$/, "")}/chat/completions`);
    } else {
      candidateUrls.push(`${rawBaseUrl}/v1/chat/completions`);
      candidateUrls.push(`${rawBaseUrl}/chat/completions`);
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (customConfig.apiKey) {
      headers["Authorization"] = `Bearer ${customConfig.apiKey}`;
    }

    let modelName = customConfig.model?.trim();
    if (!modelName) {
      if (rawBaseUrl.includes("deepseek")) {
        modelName = "deepseek-chat";
      } else {
        modelName = "gpt-4o-mini";
      }
    }

    let messages: any[] = [
      { role: "system", content: systemInstruction }
    ];

    if (imagePart) {
      const dataUrl = `data:${imagePart.mimeType};base64,${imagePart.data}`;
      messages.push({
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: {
              url: dataUrl
            }
          }
        ]
      });
    } else {
      messages.push({
        role: "user",
        content: prompt
      });
    }

    let lastError: any = null;
    let resultText = "";

    for (let i = 0; i < candidateUrls.length; i++) {
      const url = candidateUrls[i];
      try {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: modelName,
            messages,
            temperature: 0.2
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          let parsedError: any;
          try {
            parsedError = JSON.parse(errorText);
          } catch (e) {
            // non-json error
          }
          const remoteMsg = parsedError?.error?.message || errorText;
          if (errorText.trim().startsWith("<") && i < candidateUrls.length - 1) {
            // HTML response on non-last candidate, try next endpoint candidate
            continue;
          }
          if (errorText.trim().startsWith("<")) {
            throw new Error(`请求地址 (${url}) 返回了网页 HTML 内容而非 JSON 响应。请确认 Base URL 路径是否正确。`);
          }
          throw new Error(`[HTTP ${response.status}] ${remoteMsg}`);
        }

        const resDataText = await response.text();
        if (resDataText.trim().startsWith("<")) {
          if (i < candidateUrls.length - 1) {
            // Try next candidate endpoint
            continue;
          }
          throw new Error(`请求地址 (${url}) 返回了 HTML 网页而非 JSON 数据。请检查 Base URL 是否支持 OpenAI 格式接口。`);
        }

        let resData: any;
        try {
          resData = JSON.parse(resDataText);
        } catch (e) {
          throw new Error(`接口未返回有效 JSON 结构 (${resDataText.slice(0, 100)})`);
        }

        const content = resData?.choices?.[0]?.message?.content;
        if (!content) {
          throw new Error("接口未返回有效的 choices 节点数据。请检查配置的模型名称或模型输入格式。");
        }

        resultText = content;
        break; // Success! Break out of candidate loop
      } catch (err: any) {
        lastError = err;
        // If there are remaining candidates and the error was an HTML or 404 response, loop continues
      }
    }

    if (!resultText) {
      throw new Error(`[自定义 API 错误] ${lastError?.message || "连接自定义 API 接口失败"}`);
    }
    return resultText;
  }

interface ChartDataPoint {
  x: number;
  y: number;
}

function downsamplePoints(points: ChartDataPoint[], maxPoints = 20): ChartDataPoint[] {
  if (points.length <= maxPoints) return points;
  const sampled: ChartDataPoint[] = [];
  const step = points.length / maxPoints;
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.min(points.length - 1, Math.floor(i * step));
    sampled.push(points[idx]);
  }
  return sampled;
}

function parseElectroData(fileContent: string): ChartDataPoint[] {
  if (!fileContent) return [];
  const normalized = fileContent.replace(/[\t ]+/g, ",");
  const rows = normalized.split(/\r?\n/).map(row => row.trim()).filter(Boolean);
  const data: ChartDataPoint[] = [];
  let dataStartIndex = 0;
  for (let i = 0; i < rows.length; i++) {
    const cols = rows[i].split(',');
    if (cols.length >= 2 && !isNaN(Number(cols[0])) && !isNaN(Number(cols[1]))) {
      dataStartIndex = i;
      break;
    }
  }
  for (let i = dataStartIndex; i < rows.length; i++) {
    const cols = rows[i].split(',').filter(c => c !== "");
    if (cols.length >= 2) {
      const x = Number(cols[0]);
      const y = Number(cols[1]);
      if (!isNaN(x) && !isNaN(y)) {
        data.push({ x, y });
      }
    }
  }
  return data;
}

function inferDataType(fileName: string, fileContent: string): "CV" | "GCD" | "EIS" {
  const nameLower = (fileName || "").toLowerCase();
  if (nameLower.includes("eis") || nameLower.includes("impedance") || nameLower.includes("nyquist")) {
    return "EIS";
  }
  if (nameLower.includes("cv") || nameLower.includes("voltammetry") || nameLower.includes("cyclic")) {
    return "CV";
  }
  if (nameLower.includes("gcd") || nameLower.includes("charge") || nameLower.includes("discharge") || nameLower.includes("cp")) {
    return "GCD";
  }
  const contentLower = (fileContent || "").slice(0, 2000).toLowerCase();
  if (contentLower.includes("freq") || contentLower.includes("z'") || contentLower.includes("zreal") || contentLower.includes("zim")) {
    return "EIS";
  }
  if (contentLower.includes("scan rate") || contentLower.includes("segment") || contentLower.includes("sample interval")) {
    return "CV";
  }
  if (contentLower.includes("discharge current") || contentLower.includes("charge current") || contentLower.includes("current/a")) {
    if (contentLower.includes("time") && (contentLower.includes("potential") || contentLower.includes("voltage"))) {
      return "GCD";
    }
  }
  return "CV";
}

function extractCVMetrics(points: ChartDataPoint[]) {
  if (points.length === 0) return null;
  const xValues = points.map(p => p.x);
  const yValues = points.map(p => p.y);
  
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);

  let oxidationPeak = { x: 0, y: -Infinity };
  let reductionPeak = { x: 0, y: Infinity };

  for (const p of points) {
    if (p.y > oxidationPeak.y) {
      oxidationPeak = p;
    }
    if (p.y < reductionPeak.y) {
      reductionPeak = p;
    }
  }

  const deltaEp = Math.abs(oxidationPeak.x - reductionPeak.x);

  return {
    totalPoints: points.length,
    voltageRange: { min: minX, max: maxX },
    currentRange: { min: minY, max: maxY },
    oxidationPeak: oxidationPeak.y !== -Infinity ? oxidationPeak : null,
    reductionPeak: reductionPeak.y !== Infinity ? reductionPeak : null,
    polarDifferenceDeltaEp: deltaEp,
    sampleTrajectory: downsamplePoints(points, 20)
  };
}

function extractGCDMetrics(points: ChartDataPoint[]) {
  if (points.length === 0) return null;
  const xValues = points.map(p => p.x);
  const yValues = points.map(p => p.y);

  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);

  let peakIdx = 0;
  let peakY = -Infinity;
  for (let i = 0; i < points.length; i++) {
    if (points[i].y > peakY) {
      peakY = points[i].y;
      peakIdx = i;
    }
  }

  let irDrop = 0;
  if (peakIdx > 0 && peakIdx < points.length - 2) {
    const nextPoint = points[peakIdx + 1];
    irDrop = Math.max(0, points[peakIdx].y - nextPoint.y);
  }

  return {
    totalPoints: points.length,
    dischargeTimeS: maxX - minX,
    voltageRange: { min: minY, max: maxY },
    peakPotential: peakY,
    estimatedIRDropV: irDrop,
    sampleTrajectory: downsamplePoints(points, 20)
  };
}

function extractEISMetrics(points: ChartDataPoint[]) {
  if (points.length === 0) return null;
  const xValues = points.map(p => p.x);
  const yValues = points.map(p => p.y);

  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);

  const sortedByX = [...points].sort((a, b) => a.x - b.x);
  const Rs_estimate = sortedByX[0]?.x || minX;

  let maxZ2Value = -Infinity;
  for (let i = 0; i < points.length; i++) {
    if (points[i].y > maxZ2Value) {
      maxZ2Value = points[i].y;
    }
  }

  const Rct_estimate = 2 * maxZ2Value;

  return {
    totalPoints: points.length,
    estimatedRsOhm: Rs_estimate,
    estimatedRctOhm: Rct_estimate,
    maxZPrimeOhm: maxX,
    maxZDoublePrimeOhm: maxY,
    sampleTrajectory: downsamplePoints(points, 20)
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  const PORT = 3000;

  // API Route for analyzing Data (CSV/TXT as JSON array or text)
  app.post("/api/analyze-data", async (req, res) => {
    try {
      const { data, type, params, customConfig } = req.body;
      if (!data) return res.status(400).json({ error: "Missing data" });

      const points = parseElectroData(data);
      const inferred = inferDataType("", data);
      const activeType = (type && type !== "Auto") ? type : inferred;

      let extractedInfo: any = null;
      if (activeType === "CV") {
        extractedInfo = extractCVMetrics(points);
      } else if (activeType === "GCD") {
        extractedInfo = extractGCDMetrics(points);
      } else if (activeType === "EIS") {
        extractedInfo = extractEISMetrics(points);
      }

      // Dynamic calculation helper for electrochemistry physics
      let theoreticalDeduction = "";
      if (params && extractedInfo) {
        const area = parseFloat(params.electrodeArea) || 1.0;
        const mass = parseFloat(params.activeMass) || 1.0; // mg
        
        if (activeType === "CV" && extractedInfo.oxidationPeak && extractedInfo.reductionPeak) {
          const maxI_A = Math.max(Math.abs(extractedInfo.oxidationPeak.y), Math.abs(extractedInfo.reductionPeak.y));
          const currentDensity = maxI_A / area;
          theoreticalDeduction = `- 基础物理量化计算：电极比活性表面积下推算的最大峰值电流密度约为: ${currentDensity.toFixed(4)} mA/cm²。`;
        } else if (activeType === "GCD") {
          const current_mA = parseFloat(params.dischargeCurrent) || 1.0;
          const dt_s = extractedInfo.dischargeTimeS;
          const dV_v = Math.abs(extractedInfo.voltageRange.max - extractedInfo.voltageRange.min) || 1.0;
          const capacitance_Fg = (current_mA * dt_s) / (mass * dV_v);
          const capacity_mAhg = (current_mA * (dt_s / 3600)) / (mass * 1e-3);
          theoreticalDeduction = `- 基础物理量化计算：放电时间为 ${dt_s.toFixed(1)} s，在放电电压差 ${dV_v.toFixed(3)} V 下，预估该活性材料比电容 C 约为: ${capacitance_Fg.toFixed(2)} F/g；比容量 Q 约为: ${capacity_mAhg.toFixed(2)} mAh/g。`;
        } else if (activeType === "EIS") {
          theoreticalDeduction = `- 基础阻抗拟合评估：电解质溶液等效欧姆阻抗 Rs 极低频外推约 ${extractedInfo.estimatedRsOhm.toFixed(2)} Ω；界面电荷转移抗阻 Rct 半圆直观外推约 ${extractedInfo.estimatedRctOhm.toFixed(2)} Ω。`;
        }
      }

      const systemInstruction = `您是高级电化学数据分析专家与资深科研导师。能够解读电化学测量原始数据与图像，精准评估电化学系统的物理化学规律并进行科学深度的拟合诊断。

【极其重要的排版与撰写规范要求】：
1. 必须统一使用如下规定的 Markdown 结构框架，且完全包含指定的固定标题。只输出报告内容本身，严禁任何前言废话或结尾对话！

### 1. 实验条件与测量大纲
- **测试体系及物理目的**: 明确指明当前电化学测量类型（如 CV 循环伏安法 / GCD 恒流充放电 / EIS 交流阻抗），说明实验目的（如储能机理、电催化动力学、界面相容性等）。
- **实验环境与测试参数对照表**:
  | 参数名称 | 设定/测定数值 | 常用单位 | 物理含义与实验设定 |
  | :--- | :--- | :--- | :--- |
- **💡 核心通俗解读**: (用 1-2 句极其通俗形象的直白语言，概括本次测试的核心环境与物理意义，让非专业人士也能秒懂)

### 2. 核心图表与极值拟合诊断
- **关键定量物理指标提取表**:
  | 提取/拟合指标 | 测量计算数值 | 学术评级/评价 | 物理过程对应 |
  | :--- | :--- | :--- | :--- |
- **物理化学机理推演**: 深入剖析电极过程（如 CV 的氧化还原双向峰电位 Epa/Epc、极化电位差 ΔEp 与反应可逆性；GCD 的平台电势、比电容 C [F/g]、比容量 Q [mAh/g]、库仑效率 η 与 IR 降损耗；EIS 的高频欧姆阻抗 Rs、中频电荷转移阻抗 Rct 与低频 Warburg 扩散）。
- **💡 核心通俗解读**: (用极具亲和力且形象生动的通俗比喻解释上述指标。例如：将 Rct 比作“电子通过界面的过路费”，将 ΔEp 比作“反应敏捷度与发热损耗”，将 IR 降比作“电池启动瞬间的虚跌”)

### 3. 数据质量评估与科研指导
- **数据质量与偏离诊断**: 诊断是否存在严重极化、析氢析氧、测试噪声干扰或 SEI 膜不稳定现象。
- **核心科研结论**: 凝练说明该材料或测试样品的电化学性能强弱及优缺点。
- **🔬 下一步科研建议**: 给出具体的改进方案（如调控浆料配比、增加电极压实、优化电解液配方或调整扫描速率/电流密度等）。

2. 所有电化学专业缩写语一律使用标准英文形式（如 CV, GCD, EIS, Rs, Rct, Rp, CPE, Warburg, Cdl, F, V, mA, A, F/g, mAh/g 等），非学术缩写全数使用简洁明了的简体中文。`;

      let paramsText = "";
      if (params) {
        paramsText = `【测量实验环境参数】:\n` +
          (params.electrolyte ? `- 电解质溶液体系 (Electrolyte): ${params.electrolyte}\n` : "") +
          (params.referenceElectrode ? `- 使用参比电极 (Ref. Electrode): ${params.referenceElectrode}\n` : "") +
          (params.electrodeArea ? `- 工作电极有效物理面积 (Electrode Area): ${params.electrodeArea} cm²\n` : "") +
          (params.activeMass ? `- 涂覆活性物质载量 (Active Mass): ${params.activeMass} mg\n` : "") +
          (params.voltageWindow ? `- 循环或充放电电压窗口 (Voltage Window): ${params.voltageWindow} V\n` : "") +
          (params.scanRate ? `- 实验测定扫描速率 (Scan Rate): ${params.scanRate} mV/s\n` : "") +
          (params.dischargeCurrent ? `- 恒量充放电电流 (Discharge/Charge Current): ${params.dischargeCurrent} mA\n` : "") +
          (params.dcBias ? `- 极性偏置直流电位 (DC Offset Bias): ${params.dcBias} V\n` : "") +
          (params.acAmplitude ? `- EIS交流测试振幅 (AC Amplitude): ${params.acAmplitude} mV\n` : "") +
          (params.frequencyRange ? `- EIS扫描频率范围 (Frequency Range): ${params.frequencyRange}\n` : "") +
          (params.equivalentCircuit ? `- 设定等效电路图代号 (Equivalent Circuit): ${params.equivalentCircuit}\n` : "");
      }

      let promptText = "";
      if (extractedInfo) {
        promptText = `分析任务：对提供的电化学测试数据进行深度拟合与解读。
当前检测图表类别为: ${activeType}
${paramsText}
${theoreticalDeduction ? `【服务器端特征计算结果参考】：\n${theoreticalDeduction}\n` : ""}
【预处理器自动提取的完整物理及轨迹特征数据】:
${JSON.stringify(extractedInfo, null, 2)}

请基于上述特征数据，输出兼具学术专业度与通俗易懂性的分析报告。务必严格遵循【排版与内容规范要求】。`;
      } else {
        promptText = `分析任务：对提供的电化学测试数据进行深度拟合与解读。
当前检测图表类别为: ${activeType}
${paramsText}
数据头部内容（前 2000 字符，用于获取实验元数据参数）:
${typeof data === 'string' ? data.slice(0, 2000) : JSON.stringify(data).slice(0, 2000)}

请输出兼具学术专业度与通俗易懂性的分析报告。务必严格遵循【排版与内容规范要求】。`;
      }

      const reportText = await callModel({
        systemInstruction,
        prompt: promptText,
        customConfig
      });

      res.json({ report: reportText });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: formatGeminiError(error) });
    }
  });

  // API Route for analyzing Image
  app.post("/api/analyze-image", async (req, res) => {
    try {
      const { imageBase64, type, params, customConfig } = req.body;
      
      if (!imageBase64) return res.status(400).json({ error: "Missing image" });
      
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      let mimeType = "image/png";
      const match = imageBase64.match(/^data:(image\/\w+);base64,/);
      if (match) mimeType = match[1];

      const systemInstruction = `您是高级电化学数据分析专家与资深科研导师。能够解读电化学测量原始数据与图像，精准评估电化学系统的物理化学规律并进行科学深度的拟合诊断。

【极其重要的排版与撰写规范要求】：
1. 必须统一使用如下规定的 Markdown 结构框架，且完全包含指定的固定标题。只输出报告内容本身，严禁任何前言废话或结尾对话！

### 1. 实验条件与测量大纲
- **测试体系及物理目的**: 明确指明当前图表对应的电化学测量类型（如 CV 循环伏安法 / GCD 恒流充放电 / EIS 交流阻抗），说明实验目的。
- **实验环境与测试参数对照表**:
  | 参数名称 | 图像提取/设定数值 | 常用单位 | 物理含义与实验设定 |
  | :--- | :--- | :--- | :--- |
- **💡 核心通俗解读**: (用 1-2 句极其通俗形象的直白语言，概括本次测试的核心环境与物理意义，让非专业人士也能秒懂)

### 2. 核心图表与极值拟合诊断
- **关键定量物理指标提取表**:
  | 提取/拟合指标 | 图表观测估计数值 | 学术评级/评价 | 物理过程对应 |
  | :--- | :--- | :--- | :--- |
- **物理化学机理推演**: 深入剖析电极过程（如 CV 的氧化还原双向峰电位 Epa/Epc、极化电位差 ΔEp 与反应可逆性；GCD 的平台电势、比电容 C [F/g]、比容量 Q [mAh/g]、库仑效率 η 与 IR 降损耗；EIS 的高频欧姆阻抗 Rs、中频电荷转移阻抗 Rct 与低频 Warburg 扩散）。
- **💡 核心通俗解读**: (用极具亲和力且形象生动的通俗比喻解释上述指标。例如：将 Rct 比作“电子通过界面的过路费”，将 ΔEp 比作“反应敏捷度与发热损耗”，将 IR 降比作“电池启动瞬间的虚跌”)

### 3. 数据质量评估与科研指导
- **数据质量与偏离诊断**: 诊断图像波形是否存在极化偏离、严重噪声或过充现象。
- **核心科研结论**: 凝练说明该材料的电化学性能强弱及优缺点。
- **🔬 下一步科研建议**: 给出具体的改进方案（如调控浆料配比、增加电极压实、优化电解液配方或调整扫描速率/电流密度等）。

2. 所有电化学专业缩写语一律使用标准英文形式（如 CV, GCD, EIS, Rs, Rct, Rp, CPE, Warburg, Cdl, F, V, mA, A 等），非学术缩写全数使用简洁明了的简体中文。`;

      let paramsText = "";
      if (params) {
        paramsText = `\n【用户界面补充填写的实验条件与拟合设定参数】：\n` +
          (params.electrolyte ? `- 基础电解液体系 (Electrolyte): ${params.electrolyte}\n` : "") +
          (params.referenceElectrode ? `- 使用参比电极 (Ref. Electrode): ${params.referenceElectrode}\n` : "") +
          (params.electrodeArea ? `- 工作电极有效物理面积 (Electrode Area): ${params.electrodeArea} cm²\n` : "") +
          (params.activeMass ? `- 涂覆活性物质载量 (Active Mass): ${params.activeMass} mg\n` : "") +
          (params.voltageWindow ? `- 循环或充放电电压窗口 (Voltage Window): ${params.voltageWindow} V\n` : "") +
          (params.scanRate ? `- 实验测定扫描速率 (Scan Rate): ${params.scanRate} mV/s\n` : "") +
          (params.dischargeCurrent ? `- 恒量充放电电流 (Discharge/Charge Current): ${params.dischargeCurrent} mA\n` : "") +
          (params.dcBias ? `- 极性偏置直流电位 (DC Offset Bias): ${params.dcBias} V\n` : "") +
          (params.acAmplitude ? `- EIS交流测试振幅 (AC Amplitude): ${params.acAmplitude} mV\n` : "") +
          (params.frequencyRange ? `- EIS扫描频率范围 (Frequency Range): ${params.frequencyRange}\n` : "") +
          (params.equivalentCircuit ? `- 设定等效电路图代号 (Equivalent Circuit): ${params.equivalentCircuit}\n` : "");
      }

      const prompt = `图片包含电化学图表。
当前用户指定的预期图表类型为: ${type || "自动检测"}
${paramsText}

请深入观察该图表，并务必按照【极其重要的排版与撰写规范要求】输出兼具学术专业度与通俗易懂性的诊断报告。`;

      const reportText = await callModel({
        systemInstruction,
        prompt,
        imagePart: {
          data: base64Data,
          mimeType
        },
        customConfig
      });

      res.json({ report: reportText });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: formatGeminiError(error) });
    }
  });


  // API Route for comparing multiple archival records
  app.post("/api/compare-data", async (req, res) => {
    try {
      const { records, dataType, customConfig } = req.body;
      if (!records || !Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ error: "Missing compare records" });
      }

      const systemInstruction = `您是国宝级的高级电化学数据分析专家与顶级科研导师。当前任务是：对用户选择的多组电化学测试曲线数据（CV/GCD/EIS）进行联合比对分析，提炼性能差异，说明材料改性效果、动力学特征变化，并进行深度机理总结。

【极其重要的排版规范要求】：
1. 必须统一使用如下规定的 Markdown 模板框架，且完全使用这四个固定的一级标题。不要输出任何额外的废话、前言或尾声！只输出这四大部分（不要使用二级或三级标题开头，一律直接用一级标题大纲）：

### 1. 多样品/参数比对概览
- 列表对比所有参与评估的数据记录名称、数据类型以及其测试参数（电极面积、活性载量、测试窗口/速率/阻抗偏压等）。
- 对比各曲线的基准物理响应尺度（如氧化还原电流峰值、充放电时间长短、Nyquist半圆半径等）。

### 2. 核心动力学与性能指标差异
- 深度提取并横向对比各样品的关键量化性能指标（例如：计算并对比 CV 极化电位差 ΔEp 与峰值对称性；对比 GCD 能量密度、库伦效率、IR降损耗、不同样品间的比电容差值；对比 EIS 的 Rct 与欧姆内阻 Rs 差异）。
- **极度重要：** 请自动识别并在报告中高亮显示不同样品间的参数差异（特别是数值差值或倍率差，如不同样品间的比电容差值、阻抗差值等），必须使用 HTML 的 span 标签辅以醒目的色彩标记，例如：\`<span style="color: #ef4444; font-weight: bold; background-color: #fee2e2; padding: 0 4px; border-radius: 4px;">差值 1.25 F/g</span>\` 或 \`<span style="color: #059669; font-weight: bold; background-color: #d1fae5; padding: 0 4px; border-radius: 4px;">提升了 45%</span>\`，让差异在报告中一目了然！
- 定量或半定量地对样品进行优劣排序并附带物理解释（如探究为何A的动力学速率优于B，是否由于活性层面积增大、界面内阻减小或电导率提升）。

### 3. 改性机制与物理化学机理探讨
- 阐明此电化学响应差异背后折射的深层物理化学本质（如：电催化活性位点增加、锂离子扩散速率提升、SEI膜更致密稳定、或多硫化物穿梭抑制等）。
- 结合各样品的参数进行横向动力学建模评价。

### 4. 下一步科研工艺指导建议
- 给出对目标材料体系、电极压实、浆料配比或后续测试表征（如变温、变扫速、高倍率循环）的具体科学建议。

2. 所有电化学专业缩写语一律使用标准英文形式（如 CV, GCD, EIS, Rs, Rct, Rp, CPE, Warburg, Cdl, F, V, mA, A 等），非学术缩写的通俗解说和逻辑推演必须全数使用简体中文。口语化或不专业词汇视为重大失误。`;

      let promptText = `你现在需要对以下 ${records.length} 组【${dataType || '电化学'}】测试记录进行多样本联合横向分析比对：\n\n`;

      records.forEach((rec, idx) => {
        promptText += `【样本 ${idx + 1}】：${rec.fileName}\n`;
        promptText += `- 测试类别: ${rec.dataType}\n`;
        promptText += `- 测试时间: ${new Date(rec.timestamp).toLocaleDateString()} ${new Date(rec.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}\n`;
        promptText += `- 基础体系与电极: 电解液 ${rec.params?.electrolyte || '未指定'} / 参比电极 ${rec.params?.referenceElectrode || '未指定'} / 物理电极面积 ${rec.params?.electrodeArea || '1.0'} cm² / 载量活性 mass ${rec.params?.activeMass || '1.0'} mg`;
        
        if (rec.dataType === 'CV') {
          promptText += ` / 设定扫速 ${rec.params?.scanRate || '自适应'} mV/s / 电压窗口 ${rec.params?.voltageWindow || '未指定'} V`;
        } else if (rec.dataType === 'GCD') {
          promptText += ` / 外加充放电电流 ${rec.params?.dischargeCurrent || '1.0'} mA / 电压窗口 ${rec.params?.voltageWindow || '未指定'} V`;
        } else if (rec.dataType === 'EIS') {
          promptText += ` / 设定等效电路 ${rec.params?.equivalentCircuit || 'Rs+Cdl'} / 重合偏压 ${rec.params?.dcBias || '0'} V / 频率范围 ${rec.params?.frequencyRange || '未指定'} / 交流振幅 ${rec.params?.acAmplitude || '未指定'} mV`;
        }
        promptText += `\n`;
        
        if (rec.report) {
          promptText += `- 该样品的单一报告结论及数据点特征：\n${rec.report.slice(0, 800)}\n`;
        }

        if (rec.chartData && Array.isArray(rec.chartData)) {
          const len = rec.chartData.length;
          const samplePoints: any[] = [];
          if (len > 0) {
            samplePoints.push(rec.chartData[0]);
            if (len > 5) {
              samplePoints.push(rec.chartData[Math.floor(len * 0.2)]);
              samplePoints.push(rec.chartData[Math.floor(len * 0.4)]);
              samplePoints.push(rec.chartData[Math.floor(len * 0.6)]);
              samplePoints.push(rec.chartData[Math.floor(len * 0.8)]);
            }
            if (len > 1) {
              samplePoints.push(rec.chartData[len - 1]);
            }
          }
          promptText += `- 关键折返特征响应点阵 (x, y): \n${JSON.stringify(samplePoints)}\n`;
        }
        promptText += `\n--------------------------------------\n\n`;
      });

      promptText += `请深入横向横切，对比各样品的性能强弱、内阻、倍率或比容量、充放电时间特征，并严格对照【极其重要的排版规范要求】格式输出一份完美的横向对比科学诊断报告。`;

      const reportText = await callModel({
        systemInstruction,
        prompt: promptText,
        customConfig
      });

      res.json({ report: reportText });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: formatGeminiError(error) });
    }
  });

  // Global Express Error Handler to prevent HTML error responses on /api routes
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err) {
      console.error("Express App Error:", err);
      res.status(err.status || 500).json({ error: err.message || "服务器处理发生内部异常" });
      return;
    }
    next();
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
