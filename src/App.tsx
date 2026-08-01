import { useState, useRef, ChangeEvent, useMemo, useEffect } from 'react';
import { 
  UploadCloud, 
  FileType, 
  Activity, 
  FileImage, 
  Type, 
  ChartSpline, 
  Send, 
  FileText, 
  AlertCircle, 
  Loader2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Settings,
  Key,
  Globe,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  X,
  FolderPlus,
  Folder,
  Plus,
  Trash2,
  Save,
  History,
  Sparkles,
  Check,
  Copy,
  FolderOpen,
  RefreshCw,
  Download,
  BookOpen,
  Code
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import { parseElectroData } from './lib/parseData';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  ReferenceArea
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';

type ActionType = "CV" | "GCD" | "EIS" | "Auto";

interface ChartDataPoint {
  x: number;
  y: number;
}

interface CustomConfig {
  enabled: boolean;
  apiType: "default" | "openai";
  apiKey: string;
  baseUrl: string;
  model: string;
  imageUseBuiltIn: boolean;
}

interface Project {
  id: string;
  name: string;
  createdAt: number;
  description?: string;
}

interface SupplementaryParams {
  electrodeArea: string;
  activeMass: string;
  electrolyte: string;
  referenceElectrode: string;
  voltageWindow: string;
  scanRate: string;
  dischargeCurrent: string;
  dcBias: string;
  acAmplitude: string;
  frequencyRange: string;
  equivalentCircuit: string;
}

interface SavedRecord {
  id: string;
  projectId: string;
  fileName: string;
  dataType: "CV" | "GCD" | "EIS";
  timestamp: number;
  params: SupplementaryParams;
  chartData: ChartDataPoint[] | null;
  rawTextData: string;
  previewImage: string | null;
  report: string;
  notes?: string;
}

interface BatchFileItem {
  id: string;
  name: string;
  dataType: "CV" | "GCD" | "EIS";
  rawTextData: string;
  previewImage: string | null;
  chartData: ChartDataPoint[] | null;
  status: "idle" | "analyzing" | "completed" | "failed" | "saved";
  report: string | null;
  error?: string;
  params: SupplementaryParams;
}

function exportCurvesToCSV(
  curves: { name: string; dataType: "CV" | "GCD" | "EIS"; data: ChartDataPoint[] }[],
  outputFileName: string
) {
  if (curves.length === 0) return;

  const colNames: string[] = [];
  const colUnits: string[] = [];

  curves.forEach((curve) => {
    // Clean name to avoid comma/quote issues in CSV header
    const cleanName = curve.name.replace(/,/g, "_").replace(/"/g, '""');
    colNames.push(`${cleanName}_X`, `${cleanName}_Y`);

    let xUnit = "X";
    let yUnit = "Y";
    if (curve.dataType === "CV") {
      xUnit = "Potential (V)";
      yUnit = "Current (mA)";
    } else if (curve.dataType === "GCD") {
      xUnit = "Time (s)";
      yUnit = "Potential (V)";
    } else if (curve.dataType === "EIS") {
      xUnit = "Z' (Ohm)";
      yUnit = "-Z'' (Ohm)";
    }
    colUnits.push(xUnit, yUnit);
  });

  const rows: string[] = [];
  rows.push(colNames.join(","));
  rows.push(colUnits.join(","));

  // Find max data length
  const maxLength = curves.reduce((max, c) => Math.max(max, c.data ? c.data.length : 0), 0);

  // Build the data rows
  for (let j = 0; j < maxLength; j++) {
    const rowCells: string[] = [];
    curves.forEach((curve) => {
      if (curve.data && j < curve.data.length) {
        rowCells.push(String(curve.data[j].x), String(curve.data[j].y));
      } else {
        rowCells.push("", "");
      }
    });
    rows.push(rowCells.join(","));
  }

  // Prepend BOM for proper Excel / Origin / UTF-8 encoding support
  const csvContent = "\ufeff" + rows.join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", outputFileName);
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function inferDataType(fileName: string, fileContent: string): "CV" | "GCD" | "EIS" {
  const nameLower = fileName.toLowerCase();
  if (nameLower.includes("eis") || nameLower.includes("impedance") || nameLower.includes("nyquist")) {
    return "EIS";
  }
  if (nameLower.includes("cv") || nameLower.includes("voltammetry") || nameLower.includes("cyclic")) {
    return "CV";
  }
  if (nameLower.includes("gcd") || nameLower.includes("charge") || nameLower.includes("discharge") || nameLower.includes("cp")) {
    return "GCD";
  }
  
  const contentLower = fileContent.slice(0, 2000).toLowerCase();
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
  
  return "CV"; // Default fallback
}

function detectScanRate(fileName: string, fileContent: string): string {
  if (!fileName) return "50";
  const contentLower = fileContent ? fileContent.slice(0, 15000).toLowerCase() : "";
  
  // 1. Line-by-line matching of standard headers
  if (contentLower) {
    const lines = fileContent.split('\n').slice(0, 150);
    for (const line of lines) {
      const lineLower = line.toLowerCase();
      
      // Match "scan rate (v/s) = 0.05"
      const vsMatch = lineLower.match(/(?:scan|sweep|sweep\s*rate|scan\s*rate)\s*(?:\(v\/s(?:ec)?\))?\s*[:= ]\s*([0-9.eE-]+)/);
      if (vsMatch) {
        const val = parseFloat(vsMatch[1]);
        if (!isNaN(val) && val > 0 && val < 50) {
          return String(Math.round(val * 1000));
        }
      }

      // Match "scan rate (mv/s) = 50"
      const mvsMatch = lineLower.match(/(?:scan|sweep|sweep\s*rate|scan\s*rate)\s*(?:\(mv\/s(?:ec)?\))?\s*[:= ]\s*([0-9.eE-]+)/) ||
                       lineLower.match(/(?:scan|sweep|sweep\s*rate|scan\s*rate)\s*[:= ]\s*([0-9.eE-]+)\s*mv/);
      if (mvsMatch) {
        const val = parseFloat(mvsMatch[1]);
        if (!isNaN(val) && val > 0 && val < 100000) {
          return String(Math.round(val));
        }
      }
    }
  }

  // 2. Fall back to file name matching
  const nameLower = fileName.toLowerCase();
  
  // Match "100扫速" or "扫速100" or "扫速 50" etc
  let match = nameLower.match(/(\d+(?:\.\d+)?)\s*扫速/) || nameLower.match(/扫速\s*(\d+(?:\.\d+)?)/);
  if (match) {
    return match[1];
  }

  // Match "50mv" or "50mv/s" or "50mv_s" or "50mvs"
  match = nameLower.match(/(\d+(?:\.\d+)?)\s*mv/);
  if (match) {
    return match[1];
  }

  // Match "0.05v/s" or "0.05v" (V/s rate in filename)
  const vsNameMatch = nameLower.match(/(0\.\d+)\s*v/);
  if (vsNameMatch) {
    const val = parseFloat(vsNameMatch[1]);
    if (!isNaN(val) && val > 0) {
      return String(Math.round(val * 1000));
    }
  }

  // Match "cv_50.txt" or "cv-100" or "sr_10"
  match = nameLower.match(/(?:cv|scanrate|sr|rate)-?(\d+)/);
  if (match) {
    return match[1];
  }

  // If there are standalone numbers in name
  const numbers = nameLower.match(/\b(\d+)\b/g);
  if (numbers) {
    for (const num of numbers) {
      const n = parseInt(num, 10);
      if (n >= 5 && n <= 500) {
        return String(n);
      }
    }
  }

  return "50"; // Sensible default CV scan rate fallback
}

function detectGcdCurrent(fileName: string, fileContent: string): string {
  if (!fileName) return "1.0";
  const contentLower = fileContent ? fileContent.slice(0, 15000).toLowerCase() : "";
  
  // 1. Line-by-line matching of standard headers
  if (contentLower) {
    const lines = fileContent.split('\n').slice(0, 150);
    for (const line of lines) {
      const lineLower = line.toLowerCase();
      
      // Match "discharge current (a) = 0.001" or "charge current (a) = 1.0e-3" or "current (a) = 0.002"
      // or "current (a): 0.001"
      const aMatch = lineLower.match(/(?:discharge|charge|applied|anodic|cathodic|test)?\s*current\s*(?:\(a\))\s*[:= ]\s*([0-9.eE-]+)/);
      if (aMatch) {
        const val = parseFloat(aMatch[1]);
        if (!isNaN(val) && val !== 0) {
          const valMa = Math.abs(val) * 1000;
          return String(Number(valMa.toFixed(4)));
        }
      }

      // Match "discharge current (ma) = 5" or "current (ma) = 10" or "current (ma): 1"
      const maMatch = lineLower.match(/(?:discharge|charge|applied|anodic|cathodic|test)?\s*current\s*(?:\(ma\))\s*[:= ]\s*([0-9.eE-]+)/);
      if (maMatch) {
        const val = parseFloat(maMatch[1]);
        if (!isNaN(val) && val !== 0) {
          return String(Number(Math.abs(val).toFixed(4)));
        }
      }

      // Match other general formats with units in header, e.g. "discharge current = 1ma" or "current = 10 ua"
      const generalMatchWithUnit = lineLower.match(/(?:discharge|charge|applied|anodic|cathodic|test)?\s*current\s*[:= ]\s*([0-9.eE-]+)\s*(ma|ua|a)\b/);
      if (generalMatchWithUnit) {
        const val = parseFloat(generalMatchWithUnit[1]);
        const unit = generalMatchWithUnit[2];
        if (!isNaN(val) && val !== 0) {
          let valMa = Math.abs(val);
          if (unit === 'a') valMa *= 1000;
          if (unit === 'ua') valMa /= 1000;
          return String(Number(valMa.toFixed(4)));
        }
      }

      // Match "current = 0.002" or "current: 0.001" (assumed to be A if < 0.2, else mA)
      const rawMatch = lineLower.match(/(?:discharge|charge|applied|anodic|cathodic|test)?\s*current\s*[:= ]\s*([0-9.eE-]+)/);
      if (rawMatch) {
        const val = parseFloat(rawMatch[1]);
        if (!isNaN(val) && val !== 0) {
          let valMa = Math.abs(val);
          if (valMa < 0.1) {
            valMa *= 1000;
          }
          return String(Number(valMa.toFixed(4)));
        }
      }
    }
  }

  // 2. Fall back to file name matching (e.g. "gcd_10ma", "3a", "500ua", "gcd-0.5ma")
  const nameLower = fileName.toLowerCase();
  
  // Match "10ma", "0.5ma", "500ua", "1a" etc.
  const nameUnitMatch = nameLower.match(/(\d+(?:\.\d+)?)\s*(ma|ua|a)\b/);
  if (nameUnitMatch) {
    const val = parseFloat(nameUnitMatch[1]);
    const unit = nameUnitMatch[2];
    if (!isNaN(val) && val > 0) {
      let valMa = val;
      if (unit === 'a') valMa *= 1000;
      if (unit === 'ua') valMa /= 1000;
      return String(Number(valMa.toFixed(4)));
    }
  }

  // Look for standalone numbers that can represent current (typically 1, 2, 5, 10 for GCD in mA)
  const numbersGcd = nameLower.match(/\b(\d+)\b/g);
  if (numbersGcd) {
    for (const num of numbersGcd) {
      const n = parseInt(num, 10);
      if (n >= 1 && n <= 100) {
        return String(n);
      }
    }
  }

  return "1.0"; // default fallback
}

const COMPARE_COLORS = [
  '#2563eb', // Blue-600
  '#ea580c', // Orange-600
  '#10b981', // Emerald-500
  '#dc2626', // Red-600
  '#8b5cf6', // Violet-500
  '#06b6d4', // Cyan-500
];

const renderRecordChart = (rec: SavedRecord) => {
  if (rec.previewImage) {
    return <img src={rec.previewImage} alt="归档图表预览" className="max-h-[300px] max-w-full object-contain mx-auto rounded-2xl border border-zinc-200" referrerPolicy="no-referrer" />;
  }

  if (rec.chartData && rec.chartData.length > 0) {
    const activeType = rec.dataType;

    if (activeType === "EIS") {
       return (
           <ResponsiveContainer width="100%" height={260}>
            <ScatterChart margin={{ top: 15, right: 15, bottom: 25, left: 25 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
              <XAxis 
                type="number" 
                dataKey="x" 
                name="Z'" 
                tickFormatter={(v) => typeof v === 'number' ? Number(v.toFixed(4)) : v}
                tick={{fontSize: 9, fill: '#a1a1aa'}} 
                label={{ 
                  value: "Z' (Ω)", 
                  position: 'insideBottom', 
                  offset: -5, 
                  style: { fontSize: 9, fill: '#27272a', fontWeight: 600 } 
                }}
              />
              <YAxis 
                type="number" 
                dataKey="y" 
                name="-Z''" 
                tickFormatter={(v) => typeof v === 'number' ? Number(v.toFixed(4)) : v}
                tick={{fontSize: 9, fill: '#a1a1aa'}} 
                label={{ 
                  value: "-Z'' (Ω)", 
                  angle: -90, 
                  position: 'insideLeft', 
                  offset: 5, 
                  style: { fontSize: 9, fill: '#27272a', fontWeight: 600 } 
                }}
              />
              <Tooltip 
                cursor={{ strokeDasharray: '3 3' }} 
                contentStyle={{fontSize: '11px'}} 
                formatter={(value: any) => [typeof value === 'number' ? Number(value.toFixed(4)) : value]}
                labelFormatter={(label) => typeof label === 'number' ? Number(label.toFixed(4)) : label}
              />
              <Scatter name="阻抗" data={rec.chartData} fill="#10b981" line={{stroke: '#10b981', strokeWidth: 1.5}} shape="circle" />
            </ScatterChart>
          </ResponsiveContainer>
       );
    }

    let displayPoints = rec.chartData;
    let yUnit = "mA";
    if (activeType === "CV") {
      let maxYVal = 0;
      for (let i = 0; i < displayPoints.length; i++) {
        const absY = Math.abs(displayPoints[i].y);
        if (absY > maxYVal) maxYVal = absY;
      }
      let scaleY = 1;
      if (maxYVal > 0 && maxYVal < 1e-4) {
        scaleY = 1e6;
        yUnit = "μA";
      } else if (maxYVal > 0 && maxYVal < 0.1) {
        scaleY = 1e3;
        yUnit = "mA";
      } else {
        yUnit = "A";
      }
      displayPoints = displayPoints.map(p => ({ x: p.x, y: p.y * scaleY }));
    } else if (activeType === "GCD") {
      yUnit = "V";
    }

    return (
         <ResponsiveContainer width="100%" height={260}>
          <LineChart margin={{ top: 15, right: 15, bottom: 25, left: 25 }} data={displayPoints}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
            <XAxis 
              type="number" 
              dataKey="x" 
              tickFormatter={(v) => typeof v === 'number' ? Number(v.toFixed(4)) : v}
              tick={{fontSize: 9, fill: '#a1a1aa'}} 
              label={{ 
                value: activeType === "CV" ? "Potential (V)" : "Time (s)", 
                position: 'insideBottom', 
                offset: -5, 
                style: { fontSize: 9, fill: '#27272a', fontWeight: 600 } 
              }}
            />
            <YAxis 
              type="number" 
              dataKey="y" 
              tickFormatter={(v) => typeof v === 'number' ? Number(v.toFixed(4)) : v}
              tick={{fontSize: 9, fill: '#a1a1aa'}} 
              label={{ 
                value: activeType === "CV" ? `Current (${yUnit})` : "Potential (V)", 
                angle: -90, 
                position: 'insideLeft', 
                offset: 5, 
                style: { fontSize: 9, fill: '#27272a', fontWeight: 600 } 
              }}
            />
            <Tooltip 
              contentStyle={{fontSize: '11px'}} 
              formatter={(value: any) => [typeof value === 'number' ? Number(value.toFixed(4)) : value]}
              labelFormatter={(label) => typeof label === 'number' ? Number(label.toFixed(4)) : label}
            />
            <Line type="monotone" dataKey="y" stroke="#2563eb" dot={false} strokeWidth={1.8} />
          </LineChart>
        </ResponsiveContainer>
    );
  }
  
  return (
    <div className="flex flex-col justify-center items-center py-6 text-zinc-300 border border-zinc-100 rounded-2xl bg-zinc-50">
      <ChartSpline className="h-6 w-6 mb-1 opacity-40" />
      <p className="text-[10px]">无法提取此实验的二维数据点阵 (仅保存报告)</p>
    </div>
  );
};

async function parseJsonResponse(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    if (!res.ok) {
      throw new Error(`请求服务异常 (HTTP ${res.status}): ${text.slice(0, 150)}`);
    }
    throw new Error(`服务器返回非 JSON 数据: ${text.slice(0, 150)}`);
  }
}

export default function App() {
  const [dataType, setDataType] = useState<ActionType>("Auto");
  const [inferredType, setInferredType] = useState<"CV" | "GCD" | "EIS">("CV");
  const [isParamsOpen, setIsParamsOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };
  const [supplementaryParams, setSupplementaryParams] = useState({
    electrodeArea: "1.0",
    activeMass: "1.0",
    electrolyte: "",
    referenceElectrode: "",
    voltageWindow: "",
    scanRate: "",
    dischargeCurrent: "1.0",
    dcBias: "0.0",
    acAmplitude: "10.0",
    frequencyRange: "100kHz - 0.01Hz",
    equivalentCircuit: "Rs + Cdl // (Rct + Zw)"
  });

  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [chartData, setChartData] = useState<ChartDataPoint[] | null>(null);
  const [rawTextData, setRawTextData] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string>("");
  
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [saveRecordName, setSaveRecordName] = useState("");
  const [saveFeedback, setSaveFeedback] = useState("");
  const [rightSidebarTab, setRightSidebarTab] = useState<"report" | "projects">("report");

  // --- PROJECT & HISTORY STATE ---
  const [projects, setProjects] = useState<Project[]>(() => {
    const saved = localStorage.getItem("electro_projects");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {
        // use default
      }
    }
    return [{ id: "default", name: "默认项目分类", createdAt: Date.now(), description: "系统默认用于临时存储和整理的电化学项目" }];
  });

  const [records, setRecords] = useState<SavedRecord[]>(() => {
    const saved = localStorage.getItem("electro_records");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {
        // use empty
      }
    }
    return [];
  });

  const [activeProjectId, setActiveProjectId] = useState<string>("default");
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDesc, setNewProjectDesc] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);

  // --- BATCH MODE STATES ---
  const [batchFiles, setBatchFiles] = useState<BatchFileItem[]>([]);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [currentBatchIndex, setCurrentBatchIndex] = useState<number | null>(null);
  const [isBatchAnalyzing, setIsBatchAnalyzing] = useState(false);

  // --- MULTI-RUN ARCHIVE COMPARISON & SUB-PAGE STATES ---
  const [activePage, setActivePage] = useState<"workspace" | "archives">("workspace");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareReport, setCompareReport] = useState<string | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [inspectRecordId, setInspectRecordId] = useState<string | null>(null);
  const [lastSavedRecordId, setLastSavedRecordId] = useState<string | null>(null);
  const [expandedProjectIds, setExpandedProjectIds] = useState<Record<string, boolean>>({ default: true });
  const [archiveLayoutRatio, setArchiveLayoutRatio] = useState<"standard" | "equal" | "immersive" | "fullscreen">("standard");

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem("electro_projects", JSON.stringify(projects));
  }, [projects]);

  useEffect(() => {
    localStorage.setItem("electro_records", JSON.stringify(records));
  }, [records]);

  // Custom API configuration states
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [customConfig, setCustomConfig] = useState<CustomConfig>(() => {
    const defaultConfig: CustomConfig = {
      enabled: false,
      apiType: "openai",
      apiKey: "",
      baseUrl: "",
      model: "",
      imageUseBuiltIn: true
    };
    const saved = localStorage.getItem("electro_custom_config");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return { ...defaultConfig, ...parsed };
      } catch (e) {
        // use default config
      }
    }
    return defaultConfig;
  });

  const updateCustomConfig = (newVal: Partial<CustomConfig>) => {
    setCustomConfig(prev => {
      const updated = { ...prev, ...newVal };
      localStorage.setItem("electro_custom_config", JSON.stringify(updated));
      return updated;
    });
  };

  const [configInputMode, setConfigInputMode] = useState<"form" | "json">("form");
  const [jsonInputText, setJsonInputText] = useState("");
  const [jsonParseStatus, setJsonParseStatus] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const handleParseJsonConfig = (textToParse?: string) => {
    const targetText = textToParse !== undefined ? textToParse : jsonInputText;
    if (!targetText.trim()) {
      setJsonParseStatus({ type: "error", msg: "粘贴的内容不能为空" });
      return;
    }

    let apiKey = "";
    let baseUrl = "";
    let rawModel = "";

    try {
      // 1. 优先尝试标准 JSON 解析
      const parsed = JSON.parse(targetText.trim());
      if (typeof parsed === "object" && parsed !== null) {
        apiKey = parsed.apiKey || parsed.api_key || parsed.key || parsed.token || parsed.secret_key || parsed.access_token || parsed.OPENAI_API_KEY || parsed.GEMINI_API_KEY || "";
        baseUrl = parsed.baseUrl || parsed.base_url || parsed.endpoint || parsed.url || parsed.host || parsed.server || parsed.api_base || parsed.OPENAI_BASE_URL || "";
        rawModel = parsed.model || parsed.model_name || parsed.modelName || parsed.models || parsed.channel_models || parsed.OPENAI_MODEL || "";
      }
    } catch (e) {
      // 2. 正则宽容提取（兼容非标准 JSON、对象或键值文本）
      const keyMatch = targetText.match(/(?:key|token|secret|apiKey|api_key)["']?\s*[:=]\s*["']?([a-zA-Z0-9_\-\.]{8,})["']?/i);
      const urlMatch = targetText.match(/(?:url|endpoint|baseUrl|base_url|host)["']?\s*[:=]\s*["']?([^"'\s,]+)/i);
      const modelMatch = targetText.match(/(?:model|model_name|models)["']?\s*[:=]\s*["']?([^"'\s,]+)/i);

      if (keyMatch) apiKey = keyMatch[1];
      if (urlMatch) baseUrl = urlMatch[1];
      if (modelMatch) rawModel = modelMatch[1];
    }

    if (Array.isArray(rawModel)) {
      rawModel = rawModel[0] || "";
    } else if (typeof rawModel === "string" && rawModel.includes(",")) {
      rawModel = rawModel.split(",")[0].trim() || "";
    }

    if (!apiKey && !baseUrl && !rawModel) {
      setJsonParseStatus({ type: "error", msg: "未识别到有效的 API 配置信息" });
      return;
    }

    const newConfig: CustomConfig = {
      enabled: true,
      apiType: "openai",
      apiKey: String(apiKey).trim(),
      baseUrl: String(baseUrl).trim(),
      model: String(rawModel).trim(),
      imageUseBuiltIn: true
    };

    updateCustomConfig(newConfig);
    
    setJsonParseStatus({
      type: "success",
      msg: "解析成功，已自动配置"
    });

    // 自动清除提示，保证界面干净
    setTimeout(() => {
      setJsonParseStatus(null);
    }, 2500);
  };

  const clearCustomConfig = () => {
    const emptyConfig: CustomConfig = {
      enabled: false,
      apiType: "openai",
      apiKey: "",
      baseUrl: "",
      model: "",
      imageUseBuiltIn: true
    };
    updateCustomConfig(emptyConfig);
    setJsonInputText("");
    setJsonParseStatus({ type: "success", msg: "已重置配置" });
  };

  const insertJsonTemplate = (type: "deepseek" | "openai" | "newapi" | "default") => {
    let tpl: any = {};
    if (type === "deepseek") {
      tpl = {
        apiType: "openai",
        apiKey: "sk-your-deepseek-key",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat"
      };
    } else if (type === "openai") {
      tpl = {
        apiType: "openai",
        apiKey: "sk-your-openai-key",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o"
      };
    } else if (type === "newapi") {
      tpl = {
        _type: "newapi_channel_conn",
        key: "sk-your-newapi-key",
        url: "https://www.apia8.com",
        model: "gpt-4o-mini"
      };
    } else if (type === "default") {
      tpl = {
        apiType: "default",
        apiKey: "sk-your-default-key",
        model: "default-model"
      };
    }
    const formatted = JSON.stringify(tpl, null, 2);
    setJsonInputText(formatted);
    setJsonParseStatus(null);
  };

  const handleExportCurrentConfigJson = () => {
    const exportData = {
      apiKey: customConfig.apiKey,
      baseUrl: customConfig.baseUrl,
      model: customConfig.model,
      enabled: customConfig.enabled
    };
    const formatted = JSON.stringify(exportData, null, 2);
    setJsonInputText(formatted);
    try {
      navigator.clipboard.writeText(formatted);
      setJsonParseStatus({
        type: "success",
        msg: "已导出当前配置为 JSON 并复制到剪贴板！"
      });
    } catch (e) {
      setJsonParseStatus({
        type: "success",
        msg: "已导出当前配置为 JSON 写入下方文本框"
      });
    }
  };

  // Synchronize batch files state when current item details change
  useEffect(() => {
    if (isBatchMode && currentBatchIndex !== null && batchFiles[currentBatchIndex]) {
      const activeFile = batchFiles[currentBatchIndex];
      // Do block sync only if values actually differ to avoid cyclic re-renders
      if (fileName !== activeFile.name) setFileName(activeFile.name);
      if (saveRecordName !== activeFile.name.replace(/\.[^/.]+$/, "")) setSaveRecordName(activeFile.name.replace(/\.[^/.]+$/, ""));
      if (rawTextData !== (activeFile.rawTextData || "")) setRawTextData(activeFile.rawTextData || "");
      if (previewImage !== activeFile.previewImage) setPreviewImage(activeFile.previewImage);
      if (chartData !== activeFile.chartData) setChartData(activeFile.chartData);
      if (activeFile.report && report !== activeFile.report) setReport(activeFile.report);
      if (!activeFile.report && report !== null) setReport(null);
      if (dataType !== activeFile.dataType) {
        setDataType(activeFile.dataType);
        setInferredType(activeFile.dataType);
      }
      
      const p = activeFile.params;
      const newParams = {
        electrodeArea: p.electrodeArea || "1.0",
        activeMass: p.activeMass || "1.0",
        electrolyte: p.electrolyte || "",
        referenceElectrode: p.referenceElectrode || "",
        voltageWindow: p.voltageWindow || "",
        scanRate: p.scanRate || "",
        dischargeCurrent: p.dischargeCurrent || "1.0",
        dcBias: p.dcBias || "0.0",
        acAmplitude: p.acAmplitude || "10.0",
        frequencyRange: p.frequencyRange || "100kHz - 0.01Hz",
        equivalentCircuit: p.equivalentCircuit || "Rs + Cdl // (Rct + Zw)"
      };
      if (JSON.stringify(supplementaryParams) !== JSON.stringify(newParams)) {
        setSupplementaryParams(newParams);
      }
    }
  }, [currentBatchIndex, isBatchMode]);

  // Sync back local parameter updates to the active batch item
  useEffect(() => {
    if (isBatchMode && currentBatchIndex !== null) {
      setBatchFiles(prev => prev.map((f, idx) => {
        if (idx === currentBatchIndex) {
          const finalType = dataType === "Auto" ? inferredType : dataType;
          // Verify if there are changes before writing, preventing infinite loops
          if (
            JSON.stringify(f.params) !== JSON.stringify(supplementaryParams) ||
            f.dataType !== finalType ||
            f.report !== report
          ) {
            return {
              ...f,
              params: { ...supplementaryParams },
              dataType: finalType as any,
              report: report
            };
          }
        }
        return f;
      }));
    }
  }, [supplementaryParams, dataType, inferredType, report, currentBatchIndex, isBatchMode]);

  // Zoom & Pan states for standard interactive axes control
  const [xMinBound, setXMinBound] = useState<number | null>(null);
  const [xMaxBound, setXMaxBound] = useState<number | null>(null);
  const [yMinBound, setYMinBound] = useState<number | null>(null);
  const [yMaxBound, setYMaxBound] = useState<number | null>(null);

  const [xDomain, setXDomain] = useState<[number | 'auto', number | 'auto']>(['auto', 'auto']);
  const [yDomain, setYDomain] = useState<[number | 'auto', number | 'auto']>(['auto', 'auto']);

  const [refAreaLeft, setRefAreaLeft] = useState<string | number | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<string | number | null>(null);
  const [isSmoothingEnabled, setIsSmoothingEnabled] = useState(false);

  const activeType = dataType === "Auto" ? inferredType : dataType;

  // Dynamic scaling data for Recharts display
  const displayData = useMemo(() => {
    if (!chartData) return [];
    let scaleY = 1;
    if (activeType === "CV") {
      let maxYVal = 0;
      for (let i = 0; i < chartData.length; i++) {
        const absY = Math.abs(chartData[i].y);
        if (absY > maxYVal) maxYVal = absY;
      }
      if (maxYVal > 0 && maxYVal < 1e-4) {
        scaleY = 1e6;
      } else if (maxYVal > 0 && maxYVal < 0.1) {
        scaleY = 1e3;
      }
    }
    const scaled = chartData.map(p => ({ x: p.x, y: p.y * scaleY }));

    if (!isSmoothingEnabled || scaled.length < 3) {
      return scaled;
    }

    // Apply simple moving average (window size = 5)
    const windowSize = 5;
    const half = Math.floor(windowSize / 2);
    const smoothed = [];

    for (let i = 0; i < scaled.length; i++) {
      let sum = 0;
      let count = 0;
      for (let w = -half; w <= half; w++) {
        const idx = i + w;
        if (idx >= 0 && idx < scaled.length) {
          sum += scaled[idx].y;
          count++;
        }
      }
      smoothed.push({
        x: scaled[i].x,
        y: sum / count
      });
    }

    return smoothed;
  }, [chartData, activeType, isSmoothingEnabled]);

  const currentYDetails = useMemo(() => {
    if (activeType === "CV") {
      if (!chartData || chartData.length === 0) return { label: "电流 Current", unit: "mA" };
      let maxYVal = 0;
      for (let i = 0; i < chartData.length; i++) {
        const absY = Math.abs(chartData[i].y);
        if (absY > maxYVal) maxYVal = absY;
      }
      if (maxYVal > 0 && maxYVal < 1e-4) {
        return { label: "电流 Current", unit: "μA" };
      } else if (maxYVal > 0 && maxYVal < 0.1) {
        return { label: "电流 Current", unit: "mA" };
      } else {
        return { label: "电流 Current", unit: "A" };
      }
    } else if (activeType === "GCD") {
      return { label: "电位 Potential", unit: "V" };
    } else if (activeType === "EIS") {
      return { label: "虚部阻抗 -Z''", unit: "Ω" };
    }
    return { label: "Y", unit: "" };
  }, [chartData, activeType]);

  const currentXDetails = useMemo(() => {
    if (activeType === "CV") {
      return { label: "电位 Potential", unit: "V vs. Ref" };
    } else if (activeType === "GCD") {
      return { label: "时间 Time", unit: "s" };
    } else if (activeType === "EIS") {
      return { label: "实部阻抗 Z'", unit: "Ω" };
    }
    return { label: "X", unit: "" };
  }, [activeType]);

  // Update bounds automatically when displayData changes
  useEffect(() => {
    if (displayData.length > 0) {
      let minX = displayData[0].x;
      let maxX = displayData[0].x;
      let minY = displayData[0].y;
      let maxY = displayData[0].y;
      for (let i = 1; i < displayData.length; i++) {
        const p = displayData[i];
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      setXMinBound(minX);
      setXMaxBound(maxX);
      setYMinBound(minY);
      setYMaxBound(maxY);
      setXDomain([minX, maxX]);
      setYDomain([minY, maxY]);
    } else {
      setXMinBound(null);
      setXMaxBound(null);
      setYMinBound(null);
      setYMaxBound(null);
      setXDomain(['auto', 'auto']);
      setYDomain(['auto', 'auto']);
    }
  }, [displayData]);

  const handleZoomIn = () => {
    if (!chartData || chartData.length === 0) return;
    const curMinX = typeof xDomain[0] === 'number' ? xDomain[0] : (xMinBound ?? 0);
    const curMaxX = typeof xDomain[1] === 'number' ? xDomain[1] : (xMaxBound ?? 100);
    const curMinY = typeof yDomain[0] === 'number' ? yDomain[0] : (yMinBound ?? 0);
    const curMaxY = typeof yDomain[1] === 'number' ? yDomain[1] : (yMaxBound ?? 100);

    const xSpan = curMaxX - curMinX;
    const ySpan = curMaxY - curMinY;

    // Zoom in by 20%
    setXDomain([curMinX + xSpan * 0.1, curMaxX - xSpan * 0.1]);
    setYDomain([curMinY + ySpan * 0.1, curMaxY - ySpan * 0.1]);
  };

  const handleZoomOut = () => {
    if (!chartData || chartData.length === 0) return;
    const curMinX = typeof xDomain[0] === 'number' ? xDomain[0] : (xMinBound ?? 0);
    const curMaxX = typeof xDomain[1] === 'number' ? xDomain[1] : (xMaxBound ?? 100);
    const curMinY = typeof yDomain[0] === 'number' ? yDomain[0] : (yMinBound ?? 0);
    const curMaxY = typeof yDomain[1] === 'number' ? yDomain[1] : (yMaxBound ?? 100);

    const xSpan = curMaxX - curMinX;
    const ySpan = curMaxY - curMinY;

    // Zoom out by 20%
    setXDomain([curMinX - xSpan * 0.1, curMaxX + xSpan * 0.1]);
    setYDomain([curMinY - ySpan * 0.1, curMaxY + ySpan * 0.1]);
  };

  const handleResetZoom = () => {
    setRefAreaLeft(null);
    setRefAreaRight(null);
    if (xMinBound !== null && xMaxBound !== null && yMinBound !== null && yMaxBound !== null) {
      setXDomain([xMinBound, xMaxBound]);
      setYDomain([yMinBound, yMaxBound]);
    } else {
      setXDomain(['auto', 'auto']);
      setYDomain(['auto', 'auto']);
    }
  };

  const handlePan = (direction: 'left' | 'right' | 'up' | 'down') => {
    if (!chartData || chartData.length === 0) return;
    const curMinX = typeof xDomain[0] === 'number' ? xDomain[0] : (xMinBound ?? 0);
    const curMaxX = typeof xDomain[1] === 'number' ? xDomain[1] : (xMaxBound ?? 100);
    const curMinY = typeof yDomain[0] === 'number' ? yDomain[0] : (yMinBound ?? 0);
    const curMaxY = typeof yDomain[1] === 'number' ? yDomain[1] : (yMaxBound ?? 100);

    const xSpan = curMaxX - curMinX;
    const ySpan = curMaxY - curMinY;

    // Pan by 15%
    const stepX = xSpan * 0.15;
    const stepY = ySpan * 0.15;

    if (direction === 'left') {
      setXDomain([curMinX - stepX, curMaxX - stepX]);
    } else if (direction === 'right') {
      setXDomain([curMinX + stepX, curMaxX + stepX]);
    } else if (direction === 'up') {
      setYDomain([curMinY + stepY, curMaxY + stepY]);
    } else if (direction === 'down') {
      setYDomain([curMinY - stepY, curMaxY - stepY]);
    }
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (files.length > 1 || isBatchMode || batchFiles.length > 0) {
      // Auto enable Batch Mode when selecting multiple files or already in batch mode
      setIsBatchMode(true);
      const newBatchItems: BatchFileItem[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const isImage = file.type.startsWith('image/');
        const id = "batch_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 6);

        if (isImage) {
          const base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = (event) => resolve(event.target?.result as string);
            reader.readAsDataURL(file);
          });
          
          newBatchItems.push({
            id,
            name: file.name,
            dataType: dataType === "Auto" ? "CV" : dataType as any,
            rawTextData: "",
            previewImage: base64,
            chartData: null,
            status: "idle",
            report: null,
            params: { ...supplementaryParams }
          });
        } else {
          const text = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = (event) => resolve(event.target?.result as string);
            reader.readAsText(file);
          });

          let parsed: ChartDataPoint[] | null = null;
          try {
            parsed = parseElectroData(text);
          } catch (e) {}

          const inferred = inferDataType(file.name, text);
          const detectedRate = inferred === "CV" ? detectScanRate(file.name, text) : "";
          const detectedGcdCurr = inferred === "GCD" ? detectGcdCurrent(file.name, text) : "";
          
          newBatchItems.push({
            id,
            name: file.name,
            dataType: inferred,
            rawTextData: text,
            previewImage: null,
            chartData: parsed && parsed.length > 0 ? parsed : null,
            status: "idle",
            report: null,
            params: { 
              ...supplementaryParams,
              scanRate: detectedRate || supplementaryParams.scanRate,
              dischargeCurrent: detectedGcdCurr || supplementaryParams.dischargeCurrent
            }
          });
        }
      }

      setBatchFiles(prev => {
        const updated = [...prev, ...newBatchItems];
        // Select the first of the newly added if none currently selected
        if (currentBatchIndex === null || currentBatchIndex >= prev.length) {
          setCurrentBatchIndex(prev.length);
        }
        return updated;
      });
    } else {
      // Single file fallback list
      const file = files[0];
      setFileName(file.name);
      setSaveRecordName(file.name.replace(/\.[^/.]+$/, ""));
      setSelectedRecordId(null);
      setPreviewImage(null);
      setChartData(null);
      setRawTextData("");
      setReport(null);
      setErrorMsg(null);
      
      // Reset Zoom levels on file upload
      setXMinBound(null);
      setXMaxBound(null);
      setYMinBound(null);
      setYMaxBound(null);
      setXDomain(['auto', 'auto']);
      setYDomain(['auto', 'auto']);
      setRefAreaLeft(null);
      setRefAreaRight(null);

      const isImage = file.type.startsWith('image/');
      
      if (isImage) {
        const reader = new FileReader();
        reader.onload = (event) => {
          setPreviewImage(event.target?.result as string);
        };
        reader.readAsDataURL(file);
      } else {
        const reader = new FileReader();
        reader.onload = (event) => {
          const text = event.target?.result as string;
          setRawTextData(text);
          try {
            const parsed = parseElectroData(text);
            if (parsed.length > 0) {
              const inferred = inferDataType(file.name, text);
              setInferredType(inferred);
              setChartData(parsed);

              if (inferred === "CV") {
                const detectedRate = detectScanRate(file.name, text);
                if (detectedRate) {
                  setSupplementaryParams(prev => ({
                    ...prev,
                    scanRate: detectedRate
                  }));
                }
              } else if (inferred === "GCD") {
                const detectedCurr = detectGcdCurrent(file.name, text);
                if (detectedCurr) {
                  setSupplementaryParams(prev => ({
                    ...prev,
                    dischargeCurrent: detectedCurr
                  }));
                }
              }
            } else {
              setErrorMsg("未能从文件中解析出有效的数据。请确保数据为两列数值格式。");
            }
          } catch (err) {
            setErrorMsg("解析文件失败。");
          }
        };
        reader.readAsText(file);
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleBatchAnalyze = async () => {
    if (batchFiles.length === 0) return;
    setIsBatchAnalyzing(true);
    setErrorMsg(null);

    for (let i = 0; i < batchFiles.length; i++) {
      const fileItem = batchFiles[i];
      if (fileItem.status === "completed" || fileItem.status === "saved") {
        continue;
      }

      setBatchFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: "analyzing" } : f));
      setCurrentBatchIndex(i);

      try {
        let res;
        if (fileItem.previewImage) {
          res = await fetch("/api/analyze-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
              imageBase64: fileItem.previewImage, 
              type: fileItem.dataType,
              params: fileItem.params,
              customConfig: customConfig.enabled ? customConfig : undefined
            }),
          });
        } else {
          res = await fetch("/api/analyze-data", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
              data: fileItem.rawTextData, 
              type: fileItem.dataType, 
              params: fileItem.params,
              customConfig: customConfig.enabled ? customConfig : undefined
            }),
          });
        }

        const data = await parseJsonResponse(res);
        if (res.ok) {
          setBatchFiles(prev => prev.map((f, idx) => idx === i ? { 
            ...f, 
            status: "completed" as const, 
            report: data.report 
          } : f));
        } else {
          setBatchFiles(prev => prev.map((f, idx) => idx === i ? { 
            ...f, 
            status: "failed" as const, 
            error: data.error || "分析失败" 
          } : f));
        }
      } catch (err: any) {
        setBatchFiles(prev => prev.map((f, idx) => idx === i ? { 
          ...f, 
          status: "failed" as const, 
          error: err.message || "请求失败" 
        } : f));
      }

      // 600ms gap delay to obey rate limitations smoothly
      await new Promise(r => setTimeout(r, 600));
    }

    setIsBatchAnalyzing(false);
  };

  const handleBatchSaveAll = () => {
    const completedItems = batchFiles.filter(f => f.status === "completed" && f.report);
    if (completedItems.length === 0) return;

    const newRecords: SavedRecord[] = completedItems.map((fileItem, idx) => {
      const finalName = fileItem.name.replace(/\.[^/.]+$/, "");
      return {
        id: "rec_" + (Date.now() + idx).toString(36) + Math.random().toString(36).substring(2, 7),
        projectId: activeProjectId,
        fileName: finalName,
        dataType: fileItem.dataType,
        timestamp: Date.now(),
        params: { ...fileItem.params },
        chartData: fileItem.chartData,
        rawTextData: fileItem.rawTextData,
        previewImage: fileItem.previewImage,
        report: fileItem.report || "",
        notes: ""
      };
    });

    setRecords(prev => [...newRecords, ...prev]);
    setExpandedProjectIds(prev => ({ ...prev, [activeProjectId]: true }));

    setBatchFiles(prev => prev.map(f => f.status === "completed" ? { ...f, status: "saved" as const } : f));
    
    setSaveFeedback(`✓ 已成功批量归档 ${completedItems.length} 个实验记录到当前分类！`);
    setTimeout(() => {
      setSaveFeedback("");
    }, 6000);
  };

  const clearBatchQueue = () => {
    setBatchFiles([]);
    setCurrentBatchIndex(null);
    setIsBatchMode(false);
    setFileName("");
    setSaveRecordName("");
    setRawTextData("");
    setPreviewImage(null);
    setChartData(null);
    setReport(null);
    setErrorMsg(null);
  };

  const handleCreateProject = () => {
    if (!newProjectName.trim()) return;
    const newProj: Project = {
      id: "proj_" + Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
      name: newProjectName.trim(),
      createdAt: Date.now(),
      description: newProjectDesc.trim() || undefined
    };
    setProjects(prev => [...prev, newProj]);
    setActiveProjectId(newProj.id);
    setNewProjectName("");
    setNewProjectDesc("");
    setIsCreatingProject(false);
  };

  const handleDeleteProject = (projId: string) => {
    if (projId === "default") return;
    setProjects(prev => prev.filter(p => p.id !== projId));
    setRecords(prev => prev.filter(r => r.projectId !== projId));
    if (activeProjectId === projId) {
      setActiveProjectId("default");
    }
  };

  const handleDeleteRecord = (recId: string) => {
    setRecords(prev => prev.filter(r => r.id !== recId));
    if (selectedRecordId === recId) {
      setSelectedRecordId(null);
    }
  };

  const handleLoadRecord = (rec: SavedRecord) => {
    setSelectedRecordId(rec.id);
    setFileName(rec.fileName);
    setDataType(rec.dataType);
    setChartData(rec.chartData);
    setRawTextData(rec.rawTextData);
    setPreviewImage(rec.previewImage);
    setSupplementaryParams(rec.params);
    setReport(rec.report);
    setRightSidebarTab("report");
  };

  const handleSaveCurrentRecord = () => {
    if (!report) return;
    const finalRecordName = saveRecordName.trim() || fileName || `${activeType} 测量记录 (${new Date().toLocaleDateString()})`;
    
    const newId = "rec_" + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    const newRecord: SavedRecord = {
      id: newId,
      projectId: activeProjectId,
      fileName: finalRecordName,
      dataType: activeType,
      timestamp: Date.now(),
      params: { ...supplementaryParams },
      chartData: chartData,
      rawTextData: rawTextData,
      previewImage: previewImage,
      report: report,
      notes: ""
    };

    setRecords(prev => {
      const updated = [newRecord, ...prev];
      return updated;
    });
    setExpandedProjectIds(prev => ({ ...prev, [activeProjectId]: true }));
    setLastSavedRecordId(newId);
    setSaveFeedback("✓ 已成功归档至当前项目分类！");
    setTimeout(() => {
      setSaveFeedback("");
    }, 6000);
  };

  // --- MULTI-RUN COMPARISON AND STATE RESTORE HANDLERS ---
  const handleToggleCompare = (id: string) => {
    setCompareIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(x => x !== id);
      } else {
        if (prev.length >= 6) {
          return prev; // Max 6 items for comparison
        }
        return [...prev, id];
      }
    });
  };

  const handleClearCompare = () => {
    setCompareIds([]);
    setCompareReport(null);
    setCompareError(null);
  };

  const handleCompareAnalysis = async (compareRecords: SavedRecord[]) => {
    if (compareRecords.length < 2) return;
    setIsComparing(true);
    setCompareError(null);
    setCompareReport(null);

    const typeConsistent = compareRecords.every(r => r.dataType === compareRecords[0].dataType);
    if (!typeConsistent) {
      setCompareError("多曲线联立比对失败：所选电化学实验的数据格式类别必须一致（如全为 CV，或全为 EIS）。");
      setIsComparing(false);
      return;
    }

    try {
      const res = await fetch("/api/compare-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          records: compareRecords,
          dataType: compareRecords[0].dataType,
          customConfig: customConfig.enabled ? customConfig : undefined
        })
      });
      const data = await parseJsonResponse(res);
      if (res.ok) {
        setCompareReport(data.report);
      } else {
        setCompareError(data.error || "比对分析失败，请检查自定义API接口或内置模型的配置。");
      }
    } catch (err: any) {
      setCompareError(err.message || "联合报告生成失败，请检查您的网络连接与后端服务状态。");
    } finally {
      setIsComparing(false);
    }
  };

  const handleRestoreRecord = (rec: SavedRecord) => {
    setActivePage("workspace");
    setFileName(rec.fileName);
    setDataType(rec.dataType);
    setChartData(rec.chartData);
    setRawTextData(rec.rawTextData);
    setPreviewImage(rec.previewImage);
    setSupplementaryParams(rec.params);
    setReport(rec.report);
    setSelectedRecordId(rec.id);
    setRightSidebarTab("report");
    
    // Reset workspace zoom levels automatically so restored plot renders in full scale
    setRefAreaLeft(null);
    setRefAreaRight(null);
    if (rec.chartData && rec.chartData.length > 0) {
      let minX = rec.chartData[0].x;
      let maxX = rec.chartData[0].x;
      let minY = rec.chartData[0].y;
      let maxY = rec.chartData[0].y;
      for (let i = 1; i < rec.chartData.length; i++) {
        const p = rec.chartData[i];
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      setXMinBound(minX);
      setXMaxBound(maxX);
      setYMinBound(minY);
      setYMaxBound(maxY);
    }
  };

  const handleAnalyze = async () => {
    if (!previewImage && !rawTextData) {
      setErrorMsg("请先上传图像或数据文件。");
      return;
    }
    
    setSelectedRecordId(null);
    setIsLoading(true);
    setErrorMsg(null);
    setReport(null);
    
    try {
      if (previewImage) {
        const res = await fetch("/api/analyze-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            imageBase64: previewImage, 
            type: dataType,
            params: supplementaryParams,
            customConfig: customConfig.enabled ? customConfig : undefined
          }),
        });
        const data = await parseJsonResponse(res);
        if (res.ok) {
          setReport(data.report);
        } else {
          setErrorMsg(data.error || "分析失败");
        }
      } else if (rawTextData) {
        const res = await fetch("/api/analyze-data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            data: rawTextData, 
            type: dataType, 
            params: supplementaryParams,
            customConfig: customConfig.enabled ? customConfig : undefined
          }),
        });
        const data = await parseJsonResponse(res);
        if (res.ok) {
          setReport(data.report);
        } else {
          setErrorMsg(data.error || "分析失败");
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || "网络请求失败");
    } finally {
      setIsLoading(false);
    }
  };

  const renderChartOrImage = () => {
    if (previewImage) {
      return <img src={previewImage} alt="上传的图表预览" className="max-h-full max-w-full object-contain" />;
    }

    if (chartData && chartData.length > 0) {
      const handleMouseDown = (e: any) => {
        if (e && e.activePayload && e.activePayload[0]) {
          setRefAreaLeft(e.activePayload[0].payload.x);
        }
      };

      const handleMouseMove = (e: any) => {
        if (refAreaLeft !== null && e && e.activePayload && e.activePayload[0]) {
          setRefAreaRight(e.activePayload[0].payload.x);
        }
      };

      const handleMouseUp = () => {
        if (refAreaLeft === null || refAreaRight === null) {
          setRefAreaLeft(null);
          setRefAreaRight(null);
          return;
        }

        let leftVal = Number(refAreaLeft);
        let rightVal = Number(refAreaRight);

        if (leftVal === rightVal) {
          setRefAreaLeft(null);
          setRefAreaRight(null);
          return;
        }

        if (leftVal > rightVal) {
          const temp = leftVal;
          leftVal = rightVal;
          rightVal = temp;
        }

        setXDomain([leftVal, rightVal]);
        setRefAreaLeft(null);
        setRefAreaRight(null);
      };

      const activeType = dataType === "Auto" ? inferredType : dataType;

      if (activeType === "EIS") {
         return (
             <ResponsiveContainer width="100%" height="100%">
              <ScatterChart 
                margin={{ top: 20, right: 20, bottom: 30, left: 35 }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                <XAxis 
                  type="number" 
                  dataKey="x" 
                  name="Z'" 
                  domain={xDomain} 
                  tickFormatter={(v) => typeof v === 'number' ? Number(v.toFixed(4)) : v}
                  tick={{fontSize: 10, fill: '#a1a1aa'}} 
                  allowDataOverflow
                  label={{ 
                    value: `${currentXDetails.label} (${currentXDetails.unit})`, 
                    position: 'insideBottom', 
                    offset: -10, 
                    style: { fontSize: 10, fill: '#27272a', fontWeight: 600 } 
                  }}
                />
                <YAxis 
                  type="number" 
                  dataKey="y" 
                  name="-Z''" 
                  domain={yDomain} 
                  tickFormatter={(v) => typeof v === 'number' ? Number(v.toFixed(4)) : v}
                  tick={{fontSize: 10, fill: '#a1a1aa'}} 
                  allowDataOverflow
                  label={{ 
                    value: `${currentYDetails.label} (${currentYDetails.unit})`, 
                    angle: -90, 
                    position: 'insideLeft', 
                    offset: 10, 
                    style: { fontSize: 10, fill: '#27272a', fontWeight: 600 } 
                  }}
                />
                <Tooltip 
                  cursor={{ strokeDasharray: '3 3' }} 
                  contentStyle={{fontSize: '12px'}} 
                  formatter={(value: any) => [typeof value === 'number' ? Number(value.toFixed(4)) : value]}
                  labelFormatter={(label) => typeof label === 'number' ? Number(label.toFixed(4)) : label}
                />
                <Scatter name="阻抗" data={displayData} fill="#18181b" line={{stroke: '#18181b', strokeWidth: 1.5}} shape="circle" />
                {refAreaLeft && refAreaRight && (
                  <ReferenceArea x1={refAreaLeft} x2={refAreaRight} strokeOpacity={0.3} fill="#18181b" fillOpacity={0.15} />
                )}
              </ScatterChart>
            </ResponsiveContainer>
         );
      }

      return (
           <ResponsiveContainer width="100%" height="100%">
            <LineChart 
              margin={{ top: 20, right: 20, bottom: 30, left: 35 }} 
              data={displayData}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
              <XAxis 
                type="number" 
                dataKey="x" 
                domain={xDomain} 
                tickFormatter={(v) => typeof v === 'number' ? Number(v.toFixed(4)) : v}
                tick={{fontSize: 10, fill: '#a1a1aa'}} 
                allowDataOverflow
                label={{ 
                  value: `${currentXDetails.label} (${currentXDetails.unit})`, 
                  position: 'insideBottom', 
                  offset: -10, 
                  style: { fontSize: 10, fill: '#27272a', fontWeight: 600 } 
                }}
              />
              <YAxis 
                type="number" 
                dataKey="y" 
                domain={yDomain} 
                tickFormatter={(v) => typeof v === 'number' ? Number(v.toFixed(4)) : v}
                tick={{fontSize: 10, fill: '#a1a1aa'}} 
                allowDataOverflow
                label={{ 
                  value: `${currentYDetails.label} (${currentYDetails.unit})`, 
                  angle: -90, 
                  position: 'insideLeft', 
                  offset: 10, 
                  style: { fontSize: 10, fill: '#27272a', fontWeight: 600 } 
                }}
              />
              <Tooltip 
                contentStyle={{fontSize: '12px'}} 
                formatter={(value: any) => [typeof value === 'number' ? Number(value.toFixed(4)) : value]}
                labelFormatter={(label) => typeof label === 'number' ? Number(label.toFixed(4)) : label}
              />
              <Line type="monotone" dataKey="y" stroke="#27272a" dot={false} strokeWidth={1.8} />
              {refAreaLeft && refAreaRight && (
                <ReferenceArea x1={refAreaLeft} x2={refAreaRight} strokeOpacity={0.15} fill="#18181b" fillOpacity={0.08} />
              )}
            </LineChart>
          </ResponsiveContainer>
      );
    }
    
    return (
      <div className="flex flex-col justify-center items-center text-zinc-400">
        <ChartSpline className="h-7 w-7 mb-2 opacity-40" />
        <p className="text-xs">数据可视化展示区域</p>
      </div>
    );
  };

  return (
    <div className="h-screen bg-zinc-50/50 flex flex-col font-sans text-zinc-800 overflow-hidden text-sm">
      {/* Navbar */}
      <nav className="h-14 bg-white border-b border-zinc-100 px-5 flex items-center justify-between shrink-0 shadow-[0_1px_4px_rgba(0,0,0,0.01)] sticky top-0 z-50">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-zinc-900 rounded-2xl flex items-center justify-center text-white">
            <Activity className="h-3.5 w-3.5" />
          </div>
          <h1 className="text-[13.5px] font-display font-semibold tracking-tight text-zinc-900 flex items-center">
            电化学智能分析系统 <span className="text-zinc-400 font-normal text-xs ml-1.5 font-mono">Professional</span>
          </h1>
        </div>

        {/* Dynamic Navigation Tabs */}
        <div className="flex bg-zinc-50 p-0.5 rounded-2xl border border-zinc-100">
          <button
            onClick={() => setActivePage("workspace")}
            className={`flex items-center gap-1.5 px-4.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer active:scale-95 ${activePage === "workspace" ? "bg-white text-zinc-900 shadow-[0_2px_8px_rgba(0,0,0,0.03)] border border-zinc-200/40" : "text-zinc-500 hover:text-zinc-900 hover:bg-white/40"}`}
            id="nav-tab-workspace"
          >
            <Activity className="w-3.5 h-3.5 text-zinc-500" />
            <span>实验工作台</span>
          </button>
          <button
            onClick={() => {
              setActivePage("archives");
              if (!inspectRecordId && records.length > 0) {
                setInspectRecordId(records[0].id);
              }
            }}
            className={`flex items-center gap-1.5 px-4.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer active:scale-95 ${activePage === "archives" ? "bg-white text-zinc-900 shadow-[0_2px_8px_rgba(0,0,0,0.03)] border border-zinc-200/40" : "text-zinc-500 hover:text-zinc-900 hover:bg-white/40"}`}
            id="nav-tab-archives"
          >
            <History className="w-3.5 h-3.5 text-zinc-500" />
            <span>数据归档</span>
            {records.length > 0 && (
              <span className="bg-zinc-100 text-zinc-600 text-[9px] px-1.5 py-0.2 rounded-full font-bold ml-1 font-mono">
                {records.length}
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsGuideOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-xs font-medium border border-zinc-200 text-zinc-700 bg-white hover:bg-zinc-50 active:bg-zinc-100 shadow-[0_2px_8px_rgba(0,0,0,0.015)] transition-all duration-300 ease-out hover:scale-[1.006] active:scale-[0.99] gpu-accelerated cursor-pointer hover:border-zinc-300 active:scale-95 duration-150 font-sans"
            id="button-open-guide-panel"
            title="查看系统详细使用指南与教程"
          >
            <BookOpen className="w-3.5 h-3.5 text-zinc-500 animate-pulse" />
            <span>使用说明</span>
          </button>
        </div>
      </nav>

      <div className="flex-1 flex overflow-hidden">
        {activePage === "workspace" ? (
          <div className="flex-1 flex overflow-hidden animate-in fade-in duration-300 gpu-accelerated">
            {/* Left Sidebar: Configuration & Input */}
            <aside className="w-64 lg:w-72 bg-white border-r border-zinc-100 flex flex-col shrink-0 overflow-y-auto">
          {/* Sidebar mode tabs */}
          <div className="flex border-b border-zinc-100 shrink-0 text-[11px] bg-zinc-50/20">
            <button
              type="button"
              onClick={() => setIsBatchMode(false)}
              className={`flex-1 py-2.5 text-center font-medium transition-all ${!isBatchMode ? 'text-zinc-900 border-b-2 border-zinc-900 bg-white font-semibold' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50/50'}`}
              id="sidebar-tab-single"
            >
              单品分析
            </button>
            <button
              type="button"
              onClick={() => {
                setIsBatchMode(true);
                if (batchFiles.length > 0 && currentBatchIndex === null) {
                  setCurrentBatchIndex(0);
                }
              }}
              className={`flex-1 py-2.5 text-center font-medium relative transition-all ${isBatchMode ? 'text-zinc-900 border-b-2 border-zinc-900 bg-white font-semibold' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50/50'}`}
              id="sidebar-tab-batch"
            >
              <span>批量解析</span>
              {batchFiles.length > 0 && (
                <span className="absolute top-2 right-3 w-4 h-4 rounded-full bg-zinc-900 text-white font-mono flex items-center justify-center text-[8.5px] font-bold">
                  {batchFiles.length}
                </span>
              )}
            </button>
          </div>

          <div className="p-4 border-b border-zinc-100/50">
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="border border-dashed border-zinc-200 rounded-2xl p-5 flex flex-col items-center justify-center bg-white hover:border-zinc-400 hover:bg-zinc-50/40 cursor-pointer transition-all duration-300 ease-out hover:scale-[1.006] active:scale-[0.99] gpu-accelerated duration-250 shadow-[0_2px_8px_rgba(0,0,0,0.01)] group"
            >
              <input
                type="file"
                multiple={isBatchMode}
                ref={fileInputRef}
                className="hidden"
                onChange={handleFileUpload}
                accept=".csv,.txt,.dta,.jpg,.jpeg,.png"
                id="file-input-multi"
              />
              <UploadCloud className="w-5 h-5 mb-1.5 text-zinc-400 group-hover:text-zinc-600 transition-colors" />
              <span className="text-[11px] font-medium text-zinc-800">
                {isBatchMode ? "选择一组物理实验数据" : "拖入或上传实验数据"}
              </span>
              <span className="text-[9.5px] mt-1 text-center text-zinc-400 font-normal">
                支持 CSV, TXT, DTA 或图谱图像
              </span>
            </div>

            {/* If single mode & we have selected file */}
            {!isBatchMode && fileName && (
              <div className="mt-3 p-2 bg-zinc-50 rounded-2xl border border-zinc-100 text-left">
                <div className="flex justify-between items-center">
                  <span className="font-medium text-[10.5px] text-zinc-800 truncate flex-1 pr-2" title={fileName}>{fileName}</span>
                  <span className="text-[9px] bg-zinc-200 text-zinc-700 px-1.5 py-0.5 rounded font-medium shrink-0">
                    {previewImage ? '图谱图像' : '电化学数据'}
                  </span>
                </div>
              </div>
            )}

            {/* If batch mode & we have files in queue */}
            {isBatchMode && batchFiles.length > 0 && (
              <div className="mt-3 space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
                <div className="flex items-center justify-between text-[10px] text-zinc-400 font-bold uppercase tracking-wider mb-1 px-0.5">
                  <span>队列列表 ({batchFiles.length})</span>
                  <button 
                    onClick={clearBatchQueue} 
                    className="text-zinc-505 hover:text-red-600 font-semibold uppercase flex items-center gap-0.5 cursor-pointer text-[9.5px] transition-colors"
                    title="清空当前批量队列中的所有文件"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>清空</span>
                  </button>
                </div>
                {batchFiles.map((file, idx) => {
                  const isSelected = currentBatchIndex === idx;
                  let statusColor = "bg-zinc-300";
                  let statusTxt = "待解";
                  if (file.status === "analyzing") {
                    statusColor = "bg-indigo-500 animate-pulse";
                    statusTxt = "分析中";
                  } else if (file.status === "completed") {
                    statusColor = "bg-emerald-500";
                    statusTxt = "已完成";
                  } else if (file.status === "saved") {
                    statusColor = "bg-teal-600";
                    statusTxt = "已归档";
                  } else if (file.status === "failed") {
                    statusColor = "bg-rose-500";
                    statusTxt = "失败";
                  }

                  return (
                    <div 
                      key={file.id}
                      onClick={() => setCurrentBatchIndex(idx)}
                      className={`p-2.5 rounded-2xl border text-left cursor-pointer transition-all duration-150 flex items-center justify-between gap-1 group ${isSelected ? 'bg-zinc-50 border-zinc-300 shadow-[0_2px_8px_rgba(0,0,0,0.015)]' : 'bg-white hover:bg-zinc-50 border-zinc-100'}`}
                    >
                      <div className="flex-1 min-w-0 flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor}`}></span>
                        <span className={`text-[10.5px] truncate font-medium ${isSelected ? 'text-zinc-900 font-semibold' : 'text-zinc-600'}`} title={file.name}>
                          {file.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[9px] text-zinc-400 border border-zinc-100 px-1 rounded font-medium font-mono">
                          {file.dataType}
                        </span>
                        <span className={`text-[9.5px] font-medium ${file.status === "completed" || file.status === "saved" ? "text-emerald-700 font-semibold" : "text-zinc-500"}`}>
                          {statusTxt}
                        </span>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setBatchFiles(prev => prev.filter(x => x.id !== file.id));
                            if (currentBatchIndex === idx) {
                              setCurrentBatchIndex(idx > 0 ? idx - 1 : (batchFiles.length > 1 ? 0 : null));
                            } else if (currentBatchIndex !== null && currentBatchIndex > idx) {
                              setCurrentBatchIndex(currentBatchIndex - 1);
                            }
                          }}
                          className="opacity-0 group-hover:opacity-100 hover:text-red-600 p-0.5 rounded text-zinc-400 hover:bg-zinc-100 duration-150 cursor-pointer"
                          title="从队列中挪除"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="p-4 flex flex-col gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest block font-sans">数据测试方法</label>
              <div className="grid grid-cols-2 gap-1.5 font-sans">
                {(["Auto", "CV", "GCD", "EIS"] as ActionType[]).map(type => (
                  <button
                    key={type}
                    onClick={() => setDataType(type)}
                    className={`py-1.5 px-2 rounded-2xl border text-[10.5px] font-medium transition-all duration-200 active:scale-95 cursor-pointer ${dataType === type ? 'bg-zinc-900 border-zinc-900 text-white shadow-[0_2px_8px_rgba(0,0,0,0.015)]' : 'border-zinc-100 bg-zinc-50/50 text-zinc-600 hover:text-zinc-950 hover:bg-zinc-50'}`}
                  >
                    {type === "Auto" ? "Auto 自动分类" : type}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5 pt-1 border-t border-zinc-100/60 font-sans">
              <div className="flex justify-between items-center text-zinc-500">
                <span className="text-[10.5px] font-semibold text-zinc-400 uppercase tracking-widest block">等效工艺与拟合设定</span>
                <button
                  type="button"
                  onClick={() => setIsParamsOpen(true)}
                  className="text-[10px] font-medium text-zinc-600 hover:text-zinc-900 flex items-center gap-0.5 active:scale-95 cursor-pointer"
                  id="btn-params-config"
                >
                  <Settings className="w-3 h-3 text-zinc-400" />
                  <span>参数补充</span>
                </button>
              </div>
              <div className="p-2.5 border border-zinc-100 rounded-2xl bg-[#fcfcfc] text-[10.5px] text-zinc-500 space-y-1">
                {activeType === "EIS" && (
                  <div className="flex justify-between">
                    <span>等效电路:</span>
                    <span className="font-mono text-zinc-700 truncate max-w-[100px]" title={supplementaryParams.equivalentCircuit}>{supplementaryParams.equivalentCircuit || "未设定"}</span>
                  </div>
                )}
                {activeType === "CV" && (
                  <div className="flex justify-between">
                    <span>扫描速率 v:</span>
                    <span className="font-mono text-zinc-700">{supplementaryParams.scanRate ? `${supplementaryParams.scanRate} mV/s` : (detectScanRate(fileName, rawTextData) ? `${detectScanRate(fileName, rawTextData)} mV/s` : "50 mV/s")}</span>
                  </div>
                )}
                {activeType === "GCD" && (
                  <div className="flex justify-between">
                    <span>放电电流 I:</span>
                    <span className="font-mono text-zinc-700">{supplementaryParams.dischargeCurrent || "未设定"} mA</span>
                  </div>
                )}
              </div>
            </div>

            {isBatchMode ? (
              <div className="space-y-1.5 mt-1 font-sans">
                <button 
                  onClick={handleBatchAnalyze}
                  disabled={isBatchAnalyzing || batchFiles.length === 0 || batchFiles.every(f => f.status === "completed" || f.status === "saved")}
                  className="w-full py-2.5 bg-zinc-900 disabled:bg-zinc-200 disabled:text-zinc-400 hover:bg-zinc-850 text-white rounded-2xl font-medium transition-all duration-300 ease-out hover:scale-[1.006] active:scale-[0.99] gpu-accelerated duration-200 flex items-center justify-center space-x-2 text-[11px] cursor-pointer active:scale-[0.98] shadow-[0_2px_8px_rgba(0,0,0,0.015)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.025)]"
                  id="btn-batch-analyze-all"
                >
                  {isBatchAnalyzing ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>正在批量拟合分析中...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5 text-indigo-400 animate-pulse" />
                      <span>一键批量拟合与特征分析</span>
                    </>
                  )}
                </button>

                <button 
                  onClick={handleBatchSaveAll}
                  disabled={isBatchAnalyzing || !batchFiles.some(f => f.status === "completed")}
                  className="w-full py-2.5 bg-white border border-zinc-200 hover:border-zinc-300 disabled:border-zinc-100 disabled:bg-zinc-50 text-zinc-700 disabled:text-zinc-300 rounded-2xl font-medium transition-all duration-300 ease-out hover:scale-[1.006] active:scale-[0.99] gpu-accelerated duration-200 flex items-center justify-center space-x-2 text-[11px] cursor-pointer active:scale-[0.98] shadow-[0_2px_8px_rgba(0,0,0,0.015)] hover:shadow"
                  id="btn-batch-save-all"
                >
                  <Save className="h-3.5 w-3.5 text-zinc-500" />
                  <span>一键批量自动归档归类</span>
                </button>
              </div>
            ) : (
              <button 
                onClick={handleAnalyze}
                disabled={isLoading || (!previewImage && !rawTextData)}
                className="w-full py-2.5 bg-zinc-900 disabled:bg-zinc-200 hover:bg-zinc-850 active:bg-zinc-950 text-white rounded-2xl font-medium mt-1 transition-all duration-300 ease-out hover:scale-[1.006] active:scale-[0.99] gpu-accelerated duration-200 flex items-center justify-center space-x-2 text-[11px] cursor-pointer active:scale-[0.98] shadow-[0_2px_8px_rgba(0,0,0,0.015)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.025)]"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>图像及工艺多相拟合中...</span>
                  </>
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5 text-zinc-300" />
                    <span>开始单品深度拟合分析</span>
                  </>
                )}
              </button>
            )}

            {/* Custom API Collapsible Configuration Section */}
            <div className="border border-zinc-100 rounded-2xl overflow-hidden bg-zinc-50/50 mt-1">
              <button
                type="button"
                onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                className="w-full px-3 py-2 flex items-center justify-between text-zinc-700 hover:bg-zinc-50 transition-colors"
                id="custom-api-settings-toggle"
              >
                <div className="flex items-center gap-1.5">
                  <Settings className="w-3.5 h-3.5 text-zinc-500" />
                  <span className="text-[11px] font-medium">自定义 API 接口</span>
                </div>
                <div className="flex items-center gap-1">
                  {customConfig.enabled && (
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse mr-1"></span>
                  )}
                  {isSettingsOpen ? (
                    <ChevronUp className="w-3.5 h-3.5 text-zinc-400" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                  )}
                </div>
              </button>

              {isSettingsOpen && (
                <div className="p-3 border-t border-zinc-100 bg-white space-y-3">
                  {/* Enable Switch */}
                  <div className="flex items-center justify-between pb-1 border-b border-zinc-100">
                    <span className="text-[11px] font-semibold text-zinc-700">启用自定义 API</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={customConfig.enabled}
                        onChange={(e) => updateCustomConfig({ enabled: e.target.checked })}
                        className="sr-only peer" 
                        id="custom-api-switch"
                      />
                      <div className="w-8 h-4 bg-zinc-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all duration-200 ease-out peer-checked:bg-blue-600"></div>
                    </label>
                  </div>

                  {/* Mode Switcher */}
                  <div className="flex items-center bg-zinc-100/80 p-0.5 rounded-lg text-[10px]">
                    <button
                      type="button"
                      onClick={() => setConfigInputMode("form")}
                      className={`flex-1 py-1 px-2 rounded-md font-medium text-center transition-all cursor-pointer ${
                        configInputMode === "form" ? "bg-white text-zinc-800 shadow-2xs" : "text-zinc-500 hover:text-zinc-700"
                      }`}
                      id="custom-api-mode-form"
                    >
                      表单填写
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfigInputMode("json")}
                      className={`flex-1 py-1 px-2 rounded-md font-medium text-center transition-all cursor-pointer flex items-center justify-center gap-1 ${
                        configInputMode === "json" ? "bg-white text-zinc-800 shadow-2xs" : "text-zinc-500 hover:text-zinc-700"
                      }`}
                      id="custom-api-mode-json"
                    >
                      <Code className="w-3 h-3 text-blue-600" />
                      <span>粘贴 JSON</span>
                    </button>
                  </div>

                  {configInputMode === "json" ? (
                    <div className="space-y-2 pt-0.5 animate-in fade-in duration-150">
                      <div className="flex items-center justify-between text-[10px] text-zinc-500">
                        <span className="font-medium text-zinc-600">JSON 配置</span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={clearCustomConfig}
                            className="text-[9.5px] text-zinc-400 hover:text-rose-600 cursor-pointer transition-colors"
                          >
                            清空
                          </button>
                          <button
                            type="button"
                            onClick={handleExportCurrentConfigJson}
                            className="text-[9.5px] text-blue-600 hover:text-blue-800 flex items-center gap-0.5 cursor-pointer"
                            title="导出"
                          >
                            <Copy className="w-2.5 h-2.5" />
                            <span>导出</span>
                          </button>
                        </div>
                      </div>

                      <textarea
                        rows={4}
                        value={jsonInputText}
                        onChange={(e) => {
                          const val = e.target.value;
                          setJsonInputText(val);
                          if (jsonParseStatus) setJsonParseStatus(null);
                          if (val.trim().startsWith("{") && val.trim().endsWith("}")) {
                            try {
                              handleParseJsonConfig(val);
                            } catch (err) {}
                          }
                        }}
                        placeholder={`{\n  "key": "sk-...",\n  "url": "https://www.apia8.com",\n  "model": "gpt-4o-mini"\n}`}
                        className="w-full text-[10px] font-mono p-2 rounded-lg border border-zinc-200 bg-zinc-50/50 focus:bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-100 outline-none resize-none leading-relaxed placeholder:text-zinc-300"
                        id="custom-api-json-textarea"
                      />

                      <button
                        type="button"
                        onClick={() => handleParseJsonConfig()}
                        className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg text-[10.5px] font-medium transition-all duration-150 flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                        id="custom-api-parse-json-btn"
                      >
                        <Sparkles className="w-3 h-3 text-blue-200" />
                        <span>解析配置</span>
                      </button>

                      {jsonParseStatus && (
                        <div className={`p-1.5 rounded-md text-[10px] flex items-center gap-1.5 ${
                          jsonParseStatus.type === "success" 
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200" 
                            : "bg-rose-50 text-rose-700 border border-rose-200"
                        }`}>
                          <AlertCircle className="w-3 h-3 shrink-0" />
                          <span className="leading-tight">{jsonParseStatus.msg}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* 表单编辑项 */
                    <div className="space-y-2 pt-0.5 animate-in fade-in duration-150">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-zinc-500 font-medium block">API 参数配置</span>
                        <button
                          type="button"
                          onClick={clearCustomConfig}
                          className="text-[9.5px] text-zinc-400 hover:text-rose-600 transition-colors cursor-pointer"
                        >
                          重置
                        </button>
                      </div>

                      {/* API Key Input */}
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-500 font-medium block">API Key</label>
                        <div className="relative flex items-center">
                          <span className="absolute left-2.5 text-zinc-400">
                            <Key className="w-3 h-3" />
                          </span>
                          <input
                            type={showApiKey ? "text" : "password"}
                            value={customConfig.apiKey}
                            onChange={(e) => updateCustomConfig({ apiKey: e.target.value })}
                            placeholder="sk-..."
                            className="w-full text-[11px] pl-7 pr-7 py-1 rounded-md border border-zinc-200 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100 placeholder:text-zinc-300"
                            id="custom-api-key-input"
                          />
                          <button
                            type="button"
                            onClick={() => setShowApiKey(!showApiKey)}
                            className="absolute right-2 text-zinc-400 hover:text-zinc-600 cursor-pointer"
                            id="custom-api-key-toggle-visibility"
                          >
                            {showApiKey ? <EyeOff className="w-3" /> : <Eye className="w-3" />}
                          </button>
                        </div>
                      </div>

                      {/* Base URL */}
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-500 font-medium block">Base URL</label>
                        <div className="relative flex items-center">
                          <span className="absolute left-2.5 text-zinc-400">
                            <Globe className="w-3 h-3" />
                          </span>
                          <input
                            type="text"
                            value={customConfig.baseUrl}
                            onChange={(e) => updateCustomConfig({ baseUrl: e.target.value })}
                            placeholder="https://api.openai.com/v1"
                            className="w-full text-[11px] pl-7 pr-2 py-1 rounded-md border border-zinc-200 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100 placeholder:text-zinc-300"
                            id="custom-api-baseurl-input"
                          />
                        </div>
                      </div>

                      {/* Model Name */}
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-500 font-medium block">Model Name</label>
                        <input
                          type="text"
                          value={customConfig.model}
                          onChange={(e) => updateCustomConfig({ model: e.target.value })}
                          placeholder="gpt-4o-mini / deepseek-chat"
                          className="w-full text-[11px] px-2.5 py-1 rounded-md border border-zinc-200 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100 placeholder:text-zinc-300"
                          id="custom-api-model-input"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* Center Main: Visualization */}
        <main className="flex-1 flex flex-col bg-zinc-50/45 p-6 gap-4 overflow-hidden relative">
          <div className="flex-1 bg-white rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.015)] border border-zinc-100/80 flex flex-col relative overflow-hidden animate-in fade-in zoom-in-98 duration-200">
            {isBatchMode && batchFiles.length > 0 && (
              <div className="bg-blue-50/70 border-b border-blue-100 px-4 py-2.5 flex flex-col sm:flex-row justify-between items-center gap-2 text-[11px] font-sans antialiased shrink-0 animate-in slide-in-from-top-1.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-bold text-blue-800">批量解析控制台:</span>
                  <div className="flex items-center gap-1">
                    <span className="bg-white border border-blue-200 text-zinc-700 px-2 py-0.5 rounded font-extrabold font-mono">
                      总数: {batchFiles.length}
                    </span>
                    <span className="bg-blue-100 border border-blue-200 text-blue-800 px-2 py-0.5 rounded font-extrabold font-mono flex items-center gap-1">
                      {batchFiles.some(f => f.status === "analyzing") && (
                        <span className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-ping"></span>
                      )}
                      分析中: {batchFiles.filter(f => f.status === "analyzing").length}
                    </span>
                    <span className="bg-emerald-100 border border-emerald-200 text-emerald-800 px-2 py-0.5 rounded font-extrabold font-mono">
                      完成: {batchFiles.filter(f => f.status === "completed" || f.status === "saved").length}
                    </span>
                    {batchFiles.some(f => f.status === "failed") && (
                      <span className="bg-rose-100 border border-rose-200 text-rose-850 px-2 py-0.5 rounded font-extrabold font-mono animate-bounce">
                        失败: {batchFiles.filter(f => f.status === "failed").length}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  <span className="text-zinc-500 font-semibold">快速队列翻页:</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={currentBatchIndex === null || currentBatchIndex <= 0}
                      onClick={() => setCurrentBatchIndex(prev => prev !== null ? prev - 1 : 0)}
                      className="px-2 py-1 bg-white border border-zinc-200 hover:border-blue-400 disabled:border-zinc-100 enabled:hover:bg-zinc-50 text-zinc-600 disabled:opacity-40 rounded cursor-pointer duration-150 select-none font-bold flex items-center text-[10px]"
                    >
                      &larr; &nbsp;上个试样
                    </button>
                    <span className="px-2 font-mono font-bold text-zinc-800 text-[10.5px]">
                      {(currentBatchIndex !== null ? currentBatchIndex + 1 : 0)} / {batchFiles.length}
                    </span>
                    <button
                      type="button"
                      disabled={currentBatchIndex === null || currentBatchIndex >= batchFiles.length - 1}
                      onClick={() => setCurrentBatchIndex(prev => prev !== null ? prev + 1 : 0)}
                      className="px-2 py-1 bg-white border border-zinc-200 hover:border-blue-400 disabled:border-zinc-100 enabled:hover:bg-zinc-50 text-zinc-600 disabled:opacity-40 rounded cursor-pointer duration-150 select-none font-bold flex items-center text-[10px]"
                    >
                      下个试样 &nbsp;&rarr;
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="p-3 border-b border-zinc-200/40 flex flex-col sm:flex-row gap-2 justify-between sm:items-center bg-white shrink-0 font-sans">
              <h2 className="font-semibold text-xs flex items-center gap-1.5 text-zinc-800">
                <ChartSpline className="w-3.5 h-3.5 text-zinc-400" />
                <span>拟合曲线</span>
                <span className="text-[9.5px] px-1.5 py-0.5 rounded-full bg-zinc-50 border border-zinc-100/50 text-zinc-500 font-medium ml-1">
                  {dataType === "Auto" ? "自动映射" : dataType}
                </span>
              </h2>
              {chartData && chartData.length > 0 && (
                <div className="flex items-center gap-1 bg-white border border-zinc-100 rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.01)] px-1.5 py-0.5 font-mono text-[11px] self-end sm:self-auto">
                  <label className="flex items-center gap-1.5 cursor-pointer select-none text-[10.5px] font-sans px-1.5 py-1 hover:bg-zinc-50/50 rounded-lg text-zinc-600" id="label-smoothing">
                    <input 
                      type="checkbox" 
                      className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 scale-90 cursor-pointer"
                      checked={isSmoothingEnabled}
                      onChange={(e) => setIsSmoothingEnabled(e.target.checked)}
                      id="checkbox-smoothing"
                    />
                    <span>平滑滤波</span>
                  </label>
                  <div className="w-px h-3.5 bg-zinc-100 mx-1"></div>
                  <button onClick={handleZoomIn} className="p-1 hover:bg-zinc-50 text-zinc-500 hover:text-zinc-900 rounded-lg transition-colors duration-150 cursor-pointer" title="放大 (+)">
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={handleZoomOut} className="p-1 hover:bg-zinc-50 text-zinc-500 hover:text-zinc-900 rounded-lg transition-colors duration-150 cursor-pointer" title="缩小 (-)">
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={handleResetZoom} className="p-1 hover:bg-zinc-50 text-zinc-500 hover:text-zinc-900 rounded-lg transition-colors duration-150 cursor-pointer" title="重置">
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                  <div className="w-px h-3.5 bg-zinc-100 mx-1"></div>
                  <button onClick={() => handlePan('left')} className="p-1 hover:bg-zinc-50 text-zinc-500 hover:text-zinc-900 rounded-lg transition-colors duration-150 cursor-pointer" title="向左平移">
                    <ArrowLeft className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handlePan('right')} className="p-1 hover:bg-zinc-50 text-zinc-500 hover:text-zinc-900 rounded-lg transition-colors duration-150 cursor-pointer" title="向右平移">
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handlePan('up')} className="p-1 hover:bg-zinc-50 text-zinc-500 hover:text-zinc-900 rounded-lg transition-colors duration-150 cursor-pointer" title="向上平移">
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handlePan('down')} className="p-1 hover:bg-zinc-50 text-zinc-500 hover:text-zinc-900 rounded-lg transition-colors duration-150 cursor-pointer" title="向下平移">
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <div className="w-px h-3.5 bg-zinc-100 mx-1 hidden md:block"></div>
                  <span className="text-[9.5px] text-zinc-400 px-1 hidden lg:inline tracking-tight font-sans">框选曲线局部区域可智能放大</span>
                </div>
              )}
            </div>
            <div className="flex-1 p-6 flex items-center justify-center relative min-h-0 bg-white font-sans">
              {renderChartOrImage()}
            </div>
          </div>
        </main>

        {/* Right Sidebar: Report, Projects & Summary */}
        <aside className="w-72 lg:w-80 bg-white border-l border-zinc-200 flex flex-col shrink-0 overflow-hidden text-[12px]">
          {/* Tabs header */}
          <div className="bg-zinc-50 border-b border-zinc-200 flex shrink-0 text-[11px] font-bold">
            <button
              onClick={() => setRightSidebarTab("report")}
              className={`flex-1 py-2.5 text-center border-b-2 transition-colors ${rightSidebarTab === "report" ? "border-zinc-800 text-zinc-800 bg-white" : "border-transparent text-zinc-500 hover:text-zinc-800"}`}
              id="tab-report"
            >
              分析报告摘要
            </button>
            <button
              onClick={() => setRightSidebarTab("projects")}
              className={`flex-1 py-2.5 text-center border-b-2 transition-colors ${rightSidebarTab === "projects" ? "border-zinc-800 text-zinc-800 bg-white" : "border-transparent text-zinc-500 hover:text-zinc-800"}`}
              id="tab-projects"
            >
              项目与数据归档
            </button>
          </div>

          {rightSidebarTab === "report" ? (
            <div className="p-4 flex flex-col gap-4 overflow-y-auto flex-1 min-h-0 text-left">
              {errorMsg && (
                <div className="p-2 bg-red-50 border border-red-200 rounded flex gap-2 items-start text-[11px] text-red-800">
                  <AlertCircle className="w-3.5 h-3.5 text-red-600 mt-0.5 shrink-0" />
                  <p className="leading-tight">{errorMsg}</p>
                </div>
              )}

              {/* Save record widget */}
              {report && (
                <div className="p-3 bg-zinc-50/50 border border-zinc-100 rounded-2xl space-y-2.5 animate-in fade-in duration-200 text-left">
                  <div className="font-semibold text-zinc-800 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[11px] text-zinc-900 font-sans">
                      <Save className="w-3.5 h-3.5 text-zinc-500" />
                      <span>已生成报告归档</span>
                    </span>
                    <span className="text-[9px] bg-zinc-100 border border-zinc-200/40 text-zinc-600 px-1.5 py-0.5 rounded font-bold font-mono">{activeType}</span>
                  </div>
                  
                  <div className="space-y-2 text-[10.5px]">
                    <div className="space-y-1">
                      <span className="text-[9px] text-zinc-400 font-semibold block">归档项目分类</span>
                      <select
                        value={activeProjectId}
                        onChange={(e) => setActiveProjectId(e.target.value)}
                        className="w-full text-xs border border-zinc-200 rounded-2xl px-2 py-1 bg-white focus:outline-none focus:border-zinc-400 cursor-pointer text-zinc-800"
                        id="save-select-project"
                      >
                        {projects.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                    
                    <div className="space-y-1">
                      <span className="text-[9px] text-zinc-400 font-semibold block">实验记录名称</span>
                      <input
                        type="text"
                        className="w-full text-xs border border-zinc-200 rounded-2xl px-2 py-1.5 focus:outline-none focus:border-zinc-400 font-medium text-zinc-800"
                        placeholder="留空默认为数据文件名"
                        value={saveRecordName}
                        onChange={(e) => setSaveRecordName(e.target.value)}
                        id="save-record-name-input"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2 items-center justify-between pt-2 border-t border-zinc-100/60 min-h-[32px]">
                    <div className="flex-1 min-w-0">
                      {saveFeedback ? (
                        <div className="flex items-center gap-1 animate-in fade-in duration-200">
                          <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <button
                            onClick={() => {
                              if (lastSavedRecordId) {
                                setInspectRecordId(lastSavedRecordId);
                              }
                              setActivePage("archives");
                            }}
                            className="text-zinc-800 hover:text-black font-semibold hover:underline text-[9.5px] truncate text-left cursor-pointer"
                            id="btn-go-to-archive-post-save"
                          >
                            去比对查看 &rarr;
                          </button>
                        </div>
                      ) : (
                        <span className="text-[8.5px] text-zinc-400 font-normal">多项目多样本本地存储</span>
                      )}
                    </div>
                    
                    <button
                      onClick={handleSaveCurrentRecord}
                      type="button"
                      disabled={!!saveFeedback}
                      className={`px-3 py-1.5 rounded-2xl transition-all duration-300 text-[10.5px] font-medium flex items-center gap-1.5 shrink-0 cursor-pointer active:scale-95 ${
                        saveFeedback 
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-100 shadow-none" 
                          : "bg-zinc-900 hover:bg-zinc-800 text-white shadow-[0_2px_8px_rgba(0,0,0,0.015)]"
                      }`}
                      id="btn-save-record-trigger"
                    >
                      {saveFeedback ? <Check className="w-3.5 h-3.5" /> : <FolderPlus className="w-3.5 h-3.5 text-zinc-220" />}
                      <span>{saveFeedback ? "已归档" : "保存至归档目录"}</span>
                    </button>
                  </div>
                </div>
              )}

              {report ? (
                <div className="space-y-4">
                  <div className="prose prose-slate prose-sm max-w-none text-[11px] prose-p:leading-relaxed prose-a:text-zinc-900 prose-headings:text-zinc-800">
                    <ReactMarkdown rehypePlugins={[rehypeRaw]}>{report}</ReactMarkdown>
                  </div>
                  {chartData && chartData.length > 0 && (
                    <div className="pt-3 border-t border-zinc-100/60 font-sans">
                      <button
                        onClick={() => {
                          const name = fileName ? fileName.replace(/\.[^/.]+$/, "") : "workspace_data";
                          exportCurvesToCSV([{
                            name: name,
                            dataType: activeType,
                            data: chartData
                          }], `${name}_origin_export.csv`);
                        }}
                        className="w-full bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 hover:border-zinc-300 text-zinc-700 active:bg-zinc-200 duration-200 transition-all duration-300 ease-out hover:scale-[1.006] active:scale-[0.99] gpu-accelerated font-bold py-2 rounded-2xl text-[10.5px] flex items-center justify-center gap-1.5 cursor-pointer shadow-[0_2px_8px_rgba(0,0,0,0.015)] hover:shadow active:scale-95 text-center"
                        title="导出当前拟合曲线数据至标准的 CSV 文件，支持在 Origin、Excel 中一键导入二次绘图"
                        id="btn-export-workspace-csv"
                      >
                        <Download className="w-3.5 h-3.5 text-blue-600" />
                        <span>导出当前数据为 CSV (Origin/Excel)</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-zinc-300 py-12 space-y-2">
                  <Type className="w-7 h-7 opacity-30 animate-pulse text-zinc-400" />
                  <p className="text-[10px] text-zinc-400 font-bold">等待引擎生成报告...</p>
                  <p className="text-[8.5px] text-zinc-400 text-center max-w-[170px] leading-relaxed">上传数据文件或电化学曲线图像后，点击左侧按钮<b> [开始深度拟合分析] </b>即可</p>
                </div>
              )}
            </div>
          ) : (
            <div className="p-3 flex flex-col gap-4 overflow-y-auto flex-1 min-h-0 text-[11px] text-left">
              {/* Category / Project List Creator Section */}
              <div className="space-y-2.5 border-b border-zinc-100 pb-3">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-zinc-400 uppercase tracking-wider text-[10px]">分类项目目录</span>
                  <button 
                    onClick={() => setIsCreatingProject(!isCreatingProject)}
                    className="text-blue-600 hover:text-blue-800 text-[10px] font-bold flex items-center gap-0.5"
                    id="btn-create-proj-toggle"
                  >
                    <Plus className="w-3 h-3" />
                    <span>新建分类</span>
                  </button>
                </div>

                {isCreatingProject && (
                  <div className="p-2.5 bg-zinc-50 border border-zinc-200 rounded-2xl space-y-2 animate-in slide-in-from-top-1 duration-200 text-left">
                    <div className="space-y-1">
                      <span className="text-[9px] text-zinc-500 font-bold block">分类项目名称</span>
                      <input 
                        type="text"
                        placeholder="如: 富锂锰基正极LMR测试"
                        className="w-full text-xs px-2 py-1 border border-zinc-200 rounded focus:border-blue-500 focus:outline-none bg-white"
                        value={newProjectName}
                        onChange={(e) => setNewProjectName(e.target.value)}
                        id="new-project-name"
                      />
                    </div>
                    <div className="space-y-1">
                      <span className="text-[9px] text-zinc-500 font-bold block">备注描述</span>
                      <input 
                        type="text"
                        placeholder="记录该材料制备工艺等背景信息"
                        className="w-full text-xs px-2 py-1 border border-zinc-200 rounded focus:border-blue-500 focus:outline-none bg-white"
                        value={newProjectDesc}
                        onChange={(e) => setNewProjectDesc(e.target.value)}
                        id="new-project-desc"
                      />
                    </div>
                    <div className="flex gap-1.5 justify-end text-[10px]">
                      <button 
                        onClick={() => {
                          setIsCreatingProject(false);
                          setNewProjectName("");
                          setNewProjectDesc("");
                        }}
                        className="px-2 py-1 bg-zinc-200 hover:bg-zinc-300 rounded font-medium text-zinc-700 transition-colors"
                      >
                        取消
                      </button>
                      <button 
                        onClick={handleCreateProject}
                        disabled={!newProjectName.trim()}
                        className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-200 disabled:text-zinc-400 font-semibold text-white rounded transition-colors"
                        id="btn-confirm-create-proj"
                      >
                        确认创建
                      </button>
                    </div>
                  </div>
                )}

                {/* Projects Selectors scroll zone */}
                <div className="space-y-1.5">
                  <div className="flex flex-col gap-1 max-h-[145px] overflow-y-auto pr-1">
                    {projects.map(p => {
                      const counts = records.filter(r => r.projectId === p.id).length;
                      const isSelected = activeProjectId === p.id;
                      return (
                        <div 
                          key={p.id}
                          onClick={() => setActiveProjectId(p.id)}
                          className={`flex items-center justify-between p-2 rounded-2xl border cursor-pointer group transition-all duration-200 ${isSelected ? 'bg-blue-50 border-blue-200 text-blue-950 font-medium' : 'bg-white hover:bg-zinc-50 border-zinc-200 text-zinc-600'}`}
                        >
                          <div className="flex items-center gap-2 truncate max-w-[180px]" title={p.description}>
                            <Folder className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-blue-600' : 'text-zinc-400'}`} />
                            <div className="truncate text-left">
                              <span className="block truncate font-bold text-[11px]">{p.name}</span>
                              {p.description && <span className="block text-[8.5px] text-zinc-400 truncate font-normal">{p.description}</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[9px] bg-zinc-100 group-hover:bg-zinc-200 text-zinc-600 rounded px-1.5 py-0.5 font-bold font-mono">{counts} 测</span>
                            {p.id !== 'default' && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteProject(p.id);
                                }}
                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-50 hover:text-red-700 rounded text-zinc-400 transition-all duration-300 ease-out hover:scale-[1.006] active:scale-[0.99] gpu-accelerated duration-150"
                                title="删除该项目分类"
                              >
                                <Trash2 className="w-3 h-3 text-zinc-400 hover:text-red-600" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Records Inside Chosen Project */}
              <div className="flex-1 flex flex-col space-y-2 min-h-0 text-left">
                <div className="flex items-center justify-between col-span-full">
                  <span className="font-bold text-zinc-400 uppercase tracking-wider text-[10px]">
                    实验记录归档 ({records.filter(r => r.projectId === activeProjectId).length})
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 min-h-[180px]">
                  {records.filter(r => r.projectId === activeProjectId).length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-6 bg-zinc-50 border border-dashed border-zinc-200 rounded-2xl text-center text-zinc-400 h-full py-12 min-h-[140px]">
                      <History className="w-5 h-5 opacity-40 mb-1 text-zinc-400 animate-pulse" />
                      <p className="text-[10px] font-bold">该分类下无备份数据</p>
                      <p className="text-[8.5px] text-zinc-400 leading-normal max-w-[150px] mt-0.5">当分析报告完成后，可以使用【分析报告摘要】顶部的归档微件将其一键备份在此。</p>
                    </div>
                  ) : (
                    records.filter(r => r.projectId === activeProjectId).map(rec => {
                      const isActive = selectedRecordId === rec.id;
                      return (
                        <div 
                          key={rec.id}
                          onClick={() => handleLoadRecord(rec)}
                          className={`p-2.5 rounded-2xl border text-left cursor-pointer group transition-all duration-200 ${isActive ? 'bg-zinc-900 text-white border-zinc-950 shadow-[0_4px_16px_rgba(0,0,0,0.025)]' : 'bg-white hover:bg-zinc-50 border-zinc-200 text-zinc-700'}`}
                        >
                          <div className="flex justify-between items-start gap-1">
                            <span className="font-bold text-[11px] truncate block flex-1 font-sans text-left" title={rec.fileName}>{rec.fileName}</span>
                            <span className={`text-[8.5px] px-1 py-0.2 rounded font-mono font-bold shrink-0 ${isActive ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 border border-blue-100'}`}>
                              {rec.dataType}
                            </span>
                          </div>
                          
                          <div className="flex flex-wrap gap-1 mt-1.5 text-[8.5px] font-medium">
                            <span className={isActive ? 'text-zinc-300 font-normal' : 'text-zinc-500 font-normal'}>
                              {new Date(rec.timestamp).toLocaleDateString()} {new Date(rec.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                            </span>
                          </div>

                          <div className="mt-1.5 pt-1.5 border-t border-zinc-100/30 flex justify-between items-center gap-1.5">
                           <span className={`text-[8.5px] font-medium truncate ${isActive ? 'text-blue-300' : 'text-zinc-400'}`}>
                              S: {rec.params.electrodeArea || "1.0"} cm² / M: {rec.params.activeMass || "1.0"} mg
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteRecord(rec.id);
                              }}
                              className={`p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity ${isActive ? 'hover:bg-zinc-800 text-zinc-300 hover:text-white' : 'hover:bg-red-50 hover:text-red-650 text-zinc-400'}`}
                              title="删除此实验记录"
                            >
                              <Trash2 className="w-3 h-3 text-zinc-400 group-hover:text-red-500" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="py-2 px-3 border-t border-zinc-100 flex items-center justify-between bg-zinc-50 shrink-0">
            <span className="text-[9px] text-zinc-400 font-medium">本地离线智能归档存储已就绪</span>
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
          </div>
        </aside>
          </div>
        ) : (
          /* ========================================================
             RESEARCH PROJECT & DATA ARCHIVES HUB (2-PANEL OPTIMIZED)
             ======================================================== */
          (() => {
            const getLayoutClasses = (ratio: typeof archiveLayoutRatio) => {
              switch(ratio) {
                case "standard":
                  return {
                    left: "lg:w-[60%] flex flex-col gap-4 min-h-0",
                    right: "lg:w-[40%] bg-white rounded-2xl border border-zinc-200 shadow-[0_2px_8px_rgba(0,0,0,0.015)] p-4 flex flex-col h-full min-h-[440px] relative min-w-0",
                    container: "flex flex-col lg:flex-row gap-4 flex-1 min-h-0"
                  };
                case "equal":
                  return {
                    left: "lg:w-[50%] flex flex-col gap-4 min-h-0",
                    right: "lg:w-[50%] bg-white rounded-2xl border border-zinc-200 shadow-[0_2px_8px_rgba(0,0,0,0.015)] p-4 flex flex-col h-full min-h-[440px] relative min-w-0",
                    container: "flex flex-col lg:flex-row gap-4 flex-1 min-h-0"
                  };
                case "immersive":
                  return {
                    left: "lg:w-[30%] flex flex-col gap-4 min-h-0 opacity-75 hover:opacity-100 transition-opacity duration-250",
                    right: "lg:w-[70%] bg-white rounded-2xl border border-zinc-200 shadow-[0_2px_8px_rgba(0,0,0,0.015)] p-4 flex flex-col h-full min-h-[440px] relative min-w-0",
                    container: "flex flex-col lg:flex-row gap-4 flex-1 min-h-0"
                  };
                case "fullscreen":
                  return {
                    left: "hidden",
                    right: "w-full bg-white rounded-2xl border border-zinc-200 shadow-[0_2px_8px_rgba(0,0,0,0.015)] p-5 flex flex-col h-full min-h-[440px] relative min-w-0",
                    container: "flex flex-col lg:flex-row gap-4 flex-1 min-h-0"
                  };
              }
            };

            const layout = getLayoutClasses(archiveLayoutRatio);

            return (
              <div className="flex-1 flex overflow-hidden bg-zinc-50 animate-in fade-in duration-300 gpu-accelerated">
                
                {/* 1. Integrated Folder Directory Sidebar Tree */}
                <aside className="w-64 lg:w-72 bg-white border-r border-zinc-200 flex flex-col shrink-0 overflow-hidden text-left">
                  <div className="p-4 border-b border-zinc-100 flex flex-col gap-1.5 bg-zinc-50/50 shrink-0">
                    <span className="font-bold text-zinc-500 uppercase tracking-wider text-[10px]">实验档案总目录</span>
                  </div>
                  
                  {/* Global Compare Badge */}
                  <div className="p-3 bg-blue-50/40 border-b border-zinc-100 flex items-center justify-between text-[11px] shrink-0">
                    <span className="font-semibold text-zinc-700">
                      对比选择: <b className="text-blue-600 font-bold font-mono px-1">{compareIds.length}</b> / 6 组
                    </span>
                    {compareIds.length > 0 && (
                      <button 
                        onClick={handleClearCompare}
                        className="text-[10px] text-red-600 hover:text-red-800 font-bold transition-colors cursor-pointer"
                      >
                        重置勾选
                      </button>
                    )}
                  </div>

                  {/* Scroller Container */}
                  <div className="flex-1 overflow-y-auto p-3 space-y-4">
                    
                    {/* Projects Listing Title Block */}
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-zinc-400 text-[10px]">我的项目分类 ({projects.length})</span>
                        <button 
                          onClick={() => setIsCreatingProject(!isCreatingProject)}
                          className="text-blue-600 hover:text-blue-800 text-[10px] font-bold flex items-center gap-0.5"
                          id="btn-archive-create-proj"
                        >
                          <Plus className="w-3 h-3" />
                          <span>新建分类</span>
                        </button>
                      </div>

                      {/* inline creator */}
                      {isCreatingProject && (
                        <div className="p-3 bg-zinc-50 border border-zinc-200 rounded-2xl space-y-2 text-left text-xs animate-in slide-in-from-top-1 duration-150">
                          <div className="space-y-1 bg-white p-1.5 rounded border border-zinc-200/40">
                            <span className="text-[9px] text-zinc-400 font-bold block">分类项目名称</span>
                            <input 
                              type="text"
                              placeholder="如: 高电压尖晶石改性测试"
                              className="w-full text-xs py-1 px-1 bg-transparent border-none focus:outline-none focus:ring-0 font-medium"
                              value={newProjectName}
                              onChange={(e) => setNewProjectName(e.target.value)}
                              id="archive-proj-name"
                            />
                          </div>
                          <div className="space-y-1 bg-white p-1.5 rounded border border-zinc-200/40">
                            <span className="text-[9px] text-zinc-400 font-bold block">备注描述 (选填)</span>
                            <input 
                              type="text"
                              placeholder="说明材料、扫速梯度等"
                              className="w-full text-xs py-1 px-1 bg-transparent border-none focus:outline-none focus:ring-0 font-medium"
                              value={newProjectDesc}
                              onChange={(e) => setNewProjectDesc(e.target.value)}
                              id="archive-proj-desc"
                            />
                          </div>
                          <div className="flex gap-1.5 justify-end text-[10px] pt-1">
                            <button 
                              onClick={() => {
                                setIsCreatingProject(false);
                                setNewProjectName("");
                                setNewProjectDesc("");
                              }}
                              className="px-2 py-1 bg-zinc-200 hover:bg-zinc-300 rounded font-bold text-zinc-700 transition-colors"
                            >
                              取消
                            </button>
                            <button 
                              onClick={handleCreateProject}
                              disabled={!newProjectName.trim()}
                              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-200 disabled:text-zinc-400 font-bold text-white rounded transition-colors shadow-[0_2px_8px_rgba(0,0,0,0.015)]"
                            >
                              创建
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Dynamic Tree Directory List */}
                      <div className="space-y-2">
                        {projects.map(p => {
                          const pRecords = records.filter(r => r.projectId === p.id);
                          const isSelected = activeProjectId === p.id;
                          const isExpanded = !!expandedProjectIds[p.id];
                          return (
                            <div 
                              key={p.id}
                              className={`border rounded-2xl overflow-hidden transition-all duration-200 ${
                                isSelected ? 'border-blue-102 bg-blue-50/10' : 'border-zinc-200/40 bg-white'
                              }`}
                            >
                              {/* Parent Category Node Header */}
                              <div 
                                onClick={() => {
                                  setActiveProjectId(p.id);
                                  setExpandedProjectIds(prev => ({
                                    ...prev,
                                    [p.id]: !prev[p.id]
                                  }));
                                }}
                                className={`flex items-center justify-between p-2.5 cursor-pointer select-none group transition-all duration-150 ${
                                  isSelected ? 'bg-blue-50/40' : 'hover:bg-zinc-50'
                                }`}
                              >
                                <div className="flex items-center gap-1.5 truncate max-w-[170px]" title={p.description}>
                                  <span className="text-zinc-400 shrink-0">
                                    {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />}
                                  </span>
                                  {isExpanded ? (
                                    <FolderOpen className={`w-4 h-4 shrink-0 ${isSelected ? 'text-blue-600' : 'text-zinc-400'}`} />
                                  ) : (
                                    <Folder className={`w-4 h-4 shrink-0 ${isSelected ? 'text-blue-600' : 'text-zinc-400'}`} />
                                  )}
                                  <div className="truncate text-left leading-tight">
                                    <span className={`block truncate text-xs ${isSelected ? 'font-bold text-blue-950' : 'font-semibold text-zinc-700'}`}>
                                      {p.name}
                                    </span>
                                  </div>
                                </div>
                                
                                <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                                  <span className={`text-[9.5px] rounded-full px-1.5 py-0.2 font-mono font-bold ${
                                    isSelected ? 'bg-blue-100 text-blue-800' : 'bg-zinc-100 text-zinc-500'
                                  }`}>
                                    {pRecords.length}
                                  </span>
                                  {p.id !== 'default' && (
                                    <button
                                      onClick={() => handleDeleteProject(p.id)}
                                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-50 hover:text-red-700 rounded text-zinc-400 transition-all duration-300 ease-out hover:scale-[1.006] active:scale-[0.99] gpu-accelerated duration-150"
                                      title="删除该分类项目"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Child Record Nodes Sub-Tree Container */}
                              {isExpanded && (
                                <div className="bg-zinc-50/50 p-2 pl-3.5 border-t border-zinc-100 space-y-1.5 max-h-[340px] overflow-y-auto">
                                  {pRecords.length === 0 ? (
                                    <div className="text-center py-4 text-[10px] text-zinc-400 bg-white/70 rounded border border-dashed border-zinc-200 italic">
                                      暂无任何测试归档
                                    </div>
                                  ) : (
                                    pRecords.map(rec => {
                                      const isInspected = inspectRecordId === rec.id && compareIds.length < 2;
                                      const isCompareChecked = compareIds.includes(rec.id);
                                      return (
                                        <div 
                                          key={rec.id}
                                          onClick={() => {
                                            setInspectRecordId(rec.id);
                                          }}
                                          className={`p-2.5 rounded-lg border text-left cursor-pointer relative group transition-all duration-200 ${
                                            isInspected 
                                              ? 'bg-zinc-900 border-zinc-950 text-white shadow-[0_4px_16px_rgba(0,0,0,0.025)]' 
                                              : 'bg-white hover:bg-zinc-100/70 border-zinc-200 text-zinc-800 hover:border-zinc-300'
                                          }`}
                                        >
                                          <div className="flex justify-between items-start gap-1">
                                            <span className="font-bold text-[11px] truncate block flex-1" title={rec.fileName}>{rec.fileName}</span>
                                            <span className={`text-[8.5px] px-1 rounded font-mono font-bold shrink-0 ${
                                              isInspected ? 'bg-blue-600 text-white font-extrabold' : 'bg-blue-50 text-blue-700 font-bold border border-blue-102'
                                            }`}>
                                              {rec.dataType}
                                            </span>
                                          </div>
                                          
                                          <div className="mt-2 pt-1.5 border-t border-zinc-100/10 flex justify-between items-center text-[9px] text-zinc-400 leading-none">
                                            <span>{new Date(rec.timestamp).toLocaleDateString()}</span>
                                            
                                            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                              <label className="flex items-center gap-0.5 cursor-pointer select-none font-bold" title="选中参与平行比对">
                                                <input 
                                                  type="checkbox"
                                                  checked={isCompareChecked}
                                                  onChange={() => handleToggleCompare(rec.id)}
                                                  className="rounded text-blue-600 focus:ring-blue-500 border-zinc-300 scale-75 cursor-pointer"
                                                />
                                                <span className={isInspected ? 'text-zinc-300' : 'text-zinc-500 hover:text-zinc-700'}>对比</span>
                                              </label>

                                              <button
                                                onClick={() => handleDeleteRecord(rec.id)}
                                                className={`p-0.5 rounded transition-opacity ${
                                                  isInspected ? 'hover:bg-zinc-800 text-zinc-400 hover:text-white' : 'hover:bg-red-50 hover:text-red-650 text-zinc-455'
                                                }`}
                                                title="删除该记录"
                                              >
                                                <Trash2 className="w-3 h-3" />
                                              </button>
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </aside>

                {/* 2. Interactive Main Workspace: Multi-Run Comparison Mode vs Single Inspection Mode */}
                <main className="flex-1 bg-zinc-50 overflow-y-auto p-4 lg:p-5 text-left min-h-0 flex flex-col gap-4">
                  {compareIds.length >= 2 ? (
                    /* ========================================================
                       COMPARE MODE: MULTI-CURVES DIAGNOSIS WORKSPACE
                       ======================================================== */
                    (() => {
                      const comparedRecords = records.filter(r => compareIds.includes(r.id));
                      const compareType = comparedRecords[0]?.dataType;
                      const isConsistent = comparedRecords.every(r => r.dataType === compareType);

                      // Calculate unified scaling factor for all compared CV curves
                      let globalScaleY = 1;
                      if (compareType === "CV") {
                        let maxAbsY = 0;
                        comparedRecords.forEach(rec => {
                          const pts = rec.chartData || [];
                          pts.forEach(p => {
                            const absY = Math.abs(p.y);
                            if (absY > maxAbsY) maxAbsY = absY;
                          });
                        });
                        if (maxAbsY > 0 && maxAbsY < 1e-4) {
                          globalScaleY = 1e6;
                        } else if (maxAbsY > 0 && maxAbsY < 0.1) {
                          globalScaleY = 1e3;
                        }
                      }

                      // Create unified display datasets scaled with globalScaleY
                      const scaledComparedRecords = comparedRecords.map(rec => {
                        let displayPoints = rec.chartData || [];
                        if (rec.dataType === "CV") {
                          displayPoints = displayPoints.map(p => ({ x: p.x, y: p.y * globalScaleY }));
                        }
                        return {
                          ...rec,
                          displayPoints,
                        };
                      });

                      // Compute explicit chart domains to prevent Recharts rendering flat lines
                      let minX = Infinity;
                      let maxX = -Infinity;
                      let minY = Infinity;
                      let maxY = -Infinity;

                      scaledComparedRecords.forEach(rec => {
                        rec.displayPoints.forEach(p => {
                          if (p.x < minX) minX = p.x;
                          if (p.x > maxX) maxX = p.x;
                          if (p.y < minY) minY = p.y;
                          if (p.y > maxY) maxY = p.y;
                        });
                      });

                      if (minX === Infinity) minX = 0;
                      if (maxX === -Infinity) maxX = 1;
                      if (minY === Infinity) minY = 0;
                      if (maxY === -Infinity) maxY = 1;

                      // Add a 5% margin to look visually spectacular and prevent clipping/compression
                      const xPad = (maxX - minX) * 0.05 || 0.1;
                      const yPad = (maxY - minY) * 0.05 || 0.1;

                      const dynamicXDomain = [minX - xPad, maxX + xPad];
                      const dynamicYDomain = [minY - yPad, maxY + yPad];

                      return (
                        <div className="flex flex-col gap-4 w-full h-full animate-in fade-in duration-200">
                          
                          {/* Banner & Setup Segment Controller layout */}
                          <div className="bg-white rounded-2xl p-4 border border-zinc-200 shadow-[0_2px_8px_rgba(0,0,0,0.015)] shrink-0 flex flex-col md:flex-row md:items-center justify-between gap-3">
                            <div>
                              <h3 className="font-bold text-xs flex items-center gap-1.5 text-zinc-800">
                                <Sparkles className="w-4 h-4 text-blue-600" />
                                <span>平行实验联合比对评估 ({comparedRecords.length} 样品)</span>
                              </h3>
                              <p className="text-[9.5px] text-zinc-400 mt-0.5">测试体系: {compareType || "混合"}</p>
                            </div>
                            
                            {/* Segmented Layout Controls */}
                            <div className="flex items-center gap-1.5 bg-zinc-100 p-1 rounded-2xl border border-zinc-200/40 self-end md:self-auto">
                              <span className="text-[9.5px] text-zinc-500 font-bold px-1 hidden lg:inline">分布比例:</span>
                              <div className="flex bg-zinc-55 p-0.5 rounded-lg border border-zinc-200 shadow-[0_2px_8px_rgba(0,0,0,0.015)] gap-1">
                                {(["standard", "equal", "immersive", "fullscreen"] as const).map((ratio) => {
                                  const active = archiveLayoutRatio === ratio;
                                  return (
                                    <button
                                      key={ratio}
                                      onClick={() => setArchiveLayoutRatio(ratio)}
                                      className={`p-1 rounded-lg transition-all cursor-pointer border flex flex-col items-center justify-center ${
                                        active 
                                          ? "bg-white border-blue-600 ring-2 ring-blue-500/15 shadow-[0_2px_8px_rgba(0,0,0,0.015)] scale-105 z-10" 
                                          : "bg-zinc-50/60 border-zinc-200 text-zinc-500 hover:text-zinc-800 hover:bg-white hover:border-zinc-300"
                                      }`}
                                      title={
                                        ratio === "standard" ? "默认双栏比例 (3:2)" :
                                        ratio === "equal" ? "等宽双栏比对 (5:5)" :
                                        ratio === "immersive" ? "沉浸报告宽屏 (3:7)" : "满屏纯报告阅读"
                                      }
                                    >
                                      <div className="w-8 h-4 flex items-center gap-0.5 pointer-events-none">
                                        {ratio === "standard" && (
                                          <>
                                            <div className="h-full rounded-sm bg-zinc-200 w-[60%]" />
                                            <div className="h-full rounded-sm bg-blue-500 w-[40%]" />
                                          </>
                                        )}
                                        {ratio === "equal" && (
                                          <>
                                            <div className="h-full rounded-sm bg-zinc-200 w-[50%]" />
                                            <div className="h-full rounded-sm bg-blue-500 w-[50%]" />
                                          </>
                                        )}
                                        {ratio === "immersive" && (
                                          <>
                                            <div className="h-full rounded-sm bg-zinc-200 w-[30%]" />
                                            <div className="h-full rounded-sm bg-blue-500 w-[70%]" />
                                          </>
                                        )}
                                        {ratio === "fullscreen" && (
                                          <div className="h-full rounded-sm bg-blue-500 w-full" />
                                        )}
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>

                          {/* List of checked comparative chips */}
                          <div className="flex flex-wrap gap-2">
                            {comparedRecords.map((rec, index) => (
                              <div 
                                key={rec.id}
                                className="bg-white border border-zinc-200 p-2 py-1 rounded-full flex items-center gap-2 shadow-[0_2px_8px_rgba(0,0,0,0.015)]"
                              >
                                <div 
                                  className="w-2.5 h-2.5 rounded-full shrink-0" 
                                  style={{ backgroundColor: COMPARE_COLORS[index % COMPARE_COLORS.length] }}
                                />
                                <span className="font-bold text-zinc-800 text-[10.5px] truncate max-w-[130px]">{rec.fileName}</span>
                                <button
                                  onClick={() => handleToggleCompare(rec.id)}
                                  className="text-zinc-400 hover:text-red-500 p-0.5 rounded transition-all duration-300 ease-out hover:scale-[1.006] active:scale-[0.99] gpu-accelerated cursor-pointer shrink-0"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>

                          {!isConsistent ? (
                            <div className="p-8 border-2 border-dashed border-red-200 bg-red-50/55 rounded-2xl flex flex-col items-center justify-center text-center space-y-2">
                              <AlertCircle className="w-9 h-9 text-red-650" />
                              <h4 className="font-bold text-red-900 text-xs">对比样品波形协议混合不匹配</h4>
                              <p className="text-[11px] text-red-750 max-w-lg leading-relaxed">
                                多曲线图谱评估要求所选实验具有完全相同的测试类别模式。当前选取的样品包含混杂的 [{comparedRecords.map(r=>r.dataType).join(', ')}]，请在左侧列表中修改勾选以匹配类型。
                              </p>
                            </div>
                          ) : (
                            /* Adjustable Column Split ratio layout wrapper */
                            <div className={layout.container}>
                              
                              {/* Left Columns Container (Chart + Reference Parameters) */}
                              <div className={layout.left}>
                                <div className="bg-white rounded-2xl border border-zinc-200 shadow-[0_2px_8px_rgba(0,0,0,0.015)] p-4 flex-1 flex flex-col justify-between min-h-[340px]">
                                  <div className="flex justify-between items-center pb-2 border-b border-zinc-100 shrink-0">
                                    <span className="font-bold text-[10px] text-zinc-500 uppercase tracking-wide">
                                      多样本电化学联合曲线图
                                    </span>
                                  </div>
                                  <div className="flex-1 py-4 flex items-center justify-center min-h-[260px]">
                                    {compareType === "EIS" ? (
                                      <ResponsiveContainer width="100%" height={280}>
                                        <ScatterChart margin={{ top: 15, right: 15, bottom: 25, left: 15 }}>
                                          <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                                          <XAxis 
                                            type="number" 
                                            dataKey="x" 
                                            name="Z'" 
                                            domain={dynamicXDomain}
                                            tickFormatter={(v) => typeof v === 'number' ? Number(v.toFixed(4)) : v}
                                            tick={{fontSize: 9, fill: '#a1a1aa'}} 
                                            label={{ 
                                              value: "实部阻抗 Z' (Ω)", 
                                              position: 'insideBottom', 
                                              offset: -10, 
                                              style: { fontSize: 8.5, fill: '#27272a', fontWeight: 600 } 
                                            }}
                                          />
                                          <YAxis 
                                            type="number" 
                                            dataKey="y" 
                                            name="-Z''" 
                                            domain={dynamicYDomain}
                                            tickFormatter={(v) => typeof v === 'number' ? Number(v.toFixed(4)) : v}
                                            tick={{fontSize: 9, fill: '#a1a1aa'}} 
                                            label={{ 
                                              value: "虚部阻抗 -Z'' (Ω)", 
                                              angle: -90, 
                                              position: 'insideLeft', 
                                              offset: 10, 
                                              style: { fontSize: 8.5, fill: '#27272a', fontWeight: 600 } 
                                            }}
                                          />
                                          <Tooltip 
                                            cursor={{ strokeDasharray: '3 3' }} 
                                            contentStyle={{fontSize: '11px'}} 
                                            formatter={(value: any) => [typeof value === 'number' ? Number(value.toFixed(4)) : value]}
                                            labelFormatter={(label) => typeof label === 'number' ? Number(label.toFixed(4)) : label}
                                          />
                                          {scaledComparedRecords.map((rec, index) => (
                                            <Scatter 
                                              key={rec.id}
                                              name={rec.fileName} 
                                              data={rec.displayPoints} 
                                              fill={COMPARE_COLORS[index % COMPARE_COLORS.length]} 
                                              line={{stroke: COMPARE_COLORS[index % COMPARE_COLORS.length], strokeWidth: 1.5}} 
                                              shape="circle" 
                                            />
                                          ))}
                                        </ScatterChart>
                                      </ResponsiveContainer>
                                    ) : (
                                      <ResponsiveContainer width="100%" height={280}>
                                        <LineChart margin={{ top: 15, right: 15, bottom: 25, left: 15 }}>
                                          <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                                          <XAxis 
                                            type="number" 
                                            dataKey="x" 
                                            domain={dynamicXDomain}
                                            tickFormatter={(v) => typeof v === 'number' ? Number(v.toFixed(4)) : v}
                                            tick={{fontSize: 9, fill: '#a1a1aa'}} 
                                            label={{ 
                                              value: compareType === "CV" ? "电位 Potential (V)" : "充放电时间 Time (s)", 
                                              position: 'insideBottom', 
                                              offset: -10, 
                                              style: { fontSize: 8.5, fill: '#27272a', fontWeight: 600 } 
                                            }}
                                          />
                                          <YAxis 
                                            type="number" 
                                            dataKey="y" 
                                            domain={dynamicYDomain}
                                            tickFormatter={(v) => typeof v === 'number' ? Number(v.toFixed(4)) : v}
                                            tick={{fontSize: 9, fill: '#a1a1aa'}} 
                                            label={{ 
                                              value: compareType === "CV" ? `响应电流 Current (${globalScaleY === 1e6 ? "μA" : globalScaleY === 1e3 ? "mA" : "A"})` : "电势 Potential (V)", 
                                              angle: -90, 
                                              position: 'insideLeft', 
                                              offset: 10, 
                                              style: { fontSize: 8.5, fill: '#27272a', fontWeight: 600 } 
                                            }}
                                          />
                                          <Tooltip 
                                            contentStyle={{fontSize: "11px"}} 
                                            formatter={(value: any) => [typeof value === 'number' ? Number(value.toFixed(4)) : value]}
                                            labelFormatter={(label) => typeof label === 'number' ? Number(label.toFixed(4)) : label}
                                          />
                                          {scaledComparedRecords.map((rec, index) => {
                                            return (
                                              <Line 
                                                key={rec.id}
                                                data={rec.displayPoints}
                                                type="monotone" 
                                                dataKey="y" 
                                                name={rec.fileName}
                                                stroke={COMPARE_COLORS[index % COMPARE_COLORS.length]} 
                                                dot={false} 
                                                strokeWidth={2} 
                                              />
                                            );
                                          })}
                                        </LineChart>
                                      </ResponsiveContainer>
                                    )}
                                  </div>
                                </div>

                                {/* Parameters comparison chart */}
                                <div className="bg-white rounded-2xl border border-zinc-200 shadow-[0_2px_8px_rgba(0,0,0,0.015)] p-4 shrink-0">
                                  <span className="font-bold text-[10px] text-zinc-500 block mb-2 uppercase tracking-wide">平行阻抗与基础参数参考对照表</span>
                                  <div className="overflow-x-auto text-[10px]">
                                    <table className="w-full text-left border-collapse">
                                      <thead>
                                        <tr className="border-b border-zinc-200 text-zinc-500 bg-zinc-50 font-bold">
                                          <th className="py-2 px-2.5">样品名称</th>
                                          <th className="py-2 px-2.5">有效面积 S (cm²)</th>
                                          <th className="py-2 px-2.5">活性质量 M (mg)</th>
                                          {compareType === "CV" && <th className="py-2 px-2">扫速 (mV/s)</th>}
                                          {compareType === "GCD" && <th className="py-2 px-2">电化学工作电流 (mA)</th>}
                                          {compareType === "EIS" && <th className="py-2 px-2">拟合等效电路 Formula</th>}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {comparedRecords.map((r, idx) => (
                                          <tr key={r.id} className="border-b border-zinc-200/40 hover:bg-zinc-50/40">
                                            <td className="py-1.5 px-2.5 font-bold text-zinc-800 truncate max-w-[120px]">{r.fileName}</td>
                                            <td className="py-1.5 px-2.5 text-zinc-600 font-mono">{r.params?.electrodeArea || "1.0"}</td>
                                            <td className="py-1.5 px-2.5 text-zinc-600 font-mono">{r.params?.activeMass || "1.0"}</td>
                                            {compareType === "CV" && <td className="py-1.5 px-2 text-zinc-600 font-mono">{r.params?.scanRate || detectScanRate(r.fileName, r.rawTextData) || "50"}</td>}
                                            {compareType === "GCD" && <td className="py-1.5 px-2 text-zinc-600 font-mono">{r.params?.dischargeCurrent || "1.0"}</td>}
                                            {compareType === "EIS" && <td className="py-1.5 px-2 text-zinc-600 font-mono truncate max-w-[120px]" title={r.params?.equivalentCircuit}>{r.params?.equivalentCircuit || "未设置"}</td>}
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </div>

                              {/* Right Columns Container (Markdown AI Analysis Report Page) */}
                              <div className={layout.right}>
                                <div className="flex justify-between items-center pb-2 border-b border-zinc-100 mb-3 shrink-0">
                                  <span className="font-bold text-[11px] text-zinc-700 flex items-center gap-1.5">
                                    <Sparkles className="w-3.5 h-3.5 text-blue-600 animate-pulse" />
                                    <span>AI 多档案横向联合比对报告</span>
                                  </span>
                                  {compareReport && (
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        onClick={() => handleCompareAnalysis(comparedRecords)}
                                        disabled={isComparing}
                                        className="text-blue-650 hover:text-blue-800 disabled:opacity-50 p-1 px-1.5 hover:bg-zinc-105 hover:bg-blue-50/50 rounded transition-all duration-300 ease-out hover:scale-[1.006] active:scale-[0.99] gpu-accelerated text-[10px] flex items-center gap-1 cursor-pointer font-bold border border-blue-102"
                                        title="重新生成并更新多组对比诊断"
                                      >
                                        <RefreshCw className={`w-3 h-3 text-blue-500 ${isComparing ? 'animate-spin' : ''}`} />
                                        <span>重新比对</span>
                                      </button>
                                      <button
                                        onClick={() => {
                                          navigator.clipboard.writeText(compareReport);
                                          alert("✓ 报告已复制到剪贴板！");
                                        }}
                                        className="text-zinc-500 hover:text-blue-600 p-1 hover:bg-zinc-50 rounded transition-all duration-300 ease-out hover:scale-[1.006] active:scale-[0.99] gpu-accelerated text-[10px] flex items-center gap-1 cursor-pointer font-bold border border-zinc-200"
                                      >
                                        <Copy className="w-3 h-3 text-zinc-400" />
                                        <span>复制</span>
                                      </button>
                                    </div>
                                  )}
                                </div>

                                <div className="flex-1 overflow-y-auto pr-1 text-left min-h-[320px]">
                                  {compareReport ? (
                                    <div className="space-y-4">
                                      <div className="prose prose-slate max-w-none text-[11px] leading-relaxed prose-headings:text-zinc-800 prose-headings:font-bold prose-headings:mt-4 prose-strong:text-zinc-900 prose-ul:my-1">
                                        <ReactMarkdown rehypePlugins={[rehypeRaw]}>{compareReport}</ReactMarkdown>
                                      </div>
                                      {comparedRecords && comparedRecords.length > 0 && (
                                        <div className="pt-3 border-t border-zinc-100">
                                          <button
                                            onClick={() => {
                                              const curvesToExport = comparedRecords.map(r => ({
                                                name: r.fileName.replace(/\.[^/.]+$/, ""),
                                                dataType: r.dataType,
                                                data: r.chartData || []
                                              }));
                                              const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
                                              exportCurvesToCSV(curvesToExport, `comparison_${comparedRecords.length}_curves_${timestamp}.csv`);
                                            }}
                                            className="w-full bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 hover:border-zinc-300 text-zinc-700 active:bg-zinc-200 duration-200 transition-all duration-300 ease-out hover:scale-[1.006] active:scale-[0.99] gpu-accelerated font-bold py-2 rounded-2xl text-[10.5px] flex items-center justify-center gap-1.5 cursor-pointer shadow-[0_2px_8px_rgba(0,0,0,0.015)] hover:shadow active:scale-95 text-center animate-in fade-in"
                                            title="将所有比对曲线排布在相邻的X,Y列中一并导出，方便直接导入 Origin 二次对比绘图"
                                            id="btn-export-comparison-csv"
                                          >
                                            <Download className="w-3.5 h-3.5 text-blue-600 animate-pulse" />
                                            <span>导出全部比对曲线为 Origin/Excel CSV</span>
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  ) : isComparing ? (
                                    <div className="flex flex-col items-center justify-center p-8 h-full space-y-4">
                                      <Loader2 className="w-7 h-7 animate-spin text-blue-600" />
                                      <div className="text-center space-y-1">
                                        <p className="text-xs font-bold text-zinc-700 animate-pulse">正在提取横向差异参数...</p>
                                        <p className="text-[9.5px] text-zinc-400 max-w-xs">针对电极能效、界面内阻等改性机制开展多维对比诊断，请稍候。</p>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex flex-col items-center justify-center p-8 h-full space-y-3 text-zinc-400 text-center py-16">
                                      <Sparkles className="w-8 h-8 opacity-30 text-blue-600 animate-pulse animate-duration-1000" />
                                      <h4 className="font-bold text-zinc-700 text-xs">AI 联合电化学差异比对已就绪</h4>
                                      <p className="text-[9.5px] text-zinc-400 leading-relaxed max-w-[200px]">
                                        一键横向交叉分析样品极化、内阻、扫速与放电动力学机制
                                      </p>
                                      <button
                                        onClick={() => handleCompareAnalysis(comparedRecords)}
                                        type="button"
                                        className="px-4 py-2 bg-zinc-900 border border-zinc-950 font-bold hover:bg-zinc-800 text-white rounded text-[10.5px] shadow flex items-center justify-center gap-1.5 mt-2 cursor-pointer transition-all duration-300 ease-out hover:scale-[1.006] active:scale-[0.99] gpu-accelerated"
                                      >
                                        <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                                        <span>开展 AI 平行动力学比对</span>
                                      </button>
                                    </div>
                                  )}

                                  {compareError && (
                                    <div className="p-3 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-1.5 text-[10.5px] text-red-800 mt-2">
                                      <X className="w-3.5 h-3.5 mt-0.5 text-red-650 shrink-0" />
                                      <p className="leading-tight font-medium">{compareError}</p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()
                  ) : (
                    /* ========================================================
                       SINGLE INSPECTION MODE
                       ======================================================== */
                    (() => {
                      const activeRec = records.find(r => r.id === inspectRecordId) || records.find(r => r.projectId === activeProjectId);
                      if (!activeRec) {
                        return (
                          <div className="flex-1 flex flex-col items-center justify-center bg-white border border-zinc-200 rounded-2xl p-8 text-center text-zinc-400 animate-in fade-in duration-300">
                            <FolderOpen className="w-12 h-12 opacity-20 mb-2.5 text-zinc-400 animate-pulse" />
                            <h3 className="font-bold text-zinc-700 text-sm">电化学数据库</h3>
                            <p className="text-xs text-zinc-400 leading-relaxed max-w-sm mt-1">
                              电化学实验测试的备份、拟合比对中心。请在左侧项目文件夹中展开各分类，选择任意单样品或者勾选多样品进行曲线合并比较。
                            </p>
                            <button
                              onClick={() => setActivePage("workspace")}
                              className="px-4 py-2 bg-blue-650 hover:bg-blue-700 text-white font-bold rounded text-xs mt-4 flex items-center gap-1 shadow-[0_2px_8px_rgba(0,0,0,0.015)] transition-colors cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>新建测试波形导入</span>
                            </button>
                          </div>
                        );
                      }

                      return (
                        <div className="flex flex-col gap-4 w-full h-full animate-in fade-in duration-200">
                          
                          {/* Title Banner & Restoration / Scale controls */}
                          <div className="bg-white rounded-2xl border border-zinc-200 p-4 shadow-[0_2px_8px_rgba(0,0,0,0.015)] flex flex-col md:flex-row justify-between md:items-center gap-3 shrink-0">
                            <div className="text-left">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-zinc-800 text-sm truncate max-w-[280px]" title={activeRec.fileName}>
                                  {activeRec.fileName}
                                </span>
                                <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-100 font-bold px-1.5 py-0.2 rounded font-mono">
                                  {activeRec.dataType}
                                </span>
                              </div>
                              <span className="text-[10px] text-zinc-400 font-medium block mt-0.5">
                                {new Date(activeRec.timestamp).toLocaleDateString()} {new Date(activeRec.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                              </span>
                            </div>

                            {/* Center-Right layout adjusting segment slider */}
                            <div className="flex items-center gap-1.5 bg-zinc-100 p-1 rounded-2xl border border-zinc-200/40 self-end md:self-auto">
                              <span className="text-[9.5px] text-zinc-500 font-bold px-1 hidden lg:inline">分布比例:</span>
                              <div className="flex bg-zinc-50 p-0.5 rounded-lg border border-zinc-200 shadow-[0_2px_8px_rgba(0,0,0,0.015)] gap-1">
                                {(["standard", "equal", "immersive", "fullscreen"] as const).map((ratio) => {
                                  const active = archiveLayoutRatio === ratio;
                                  return (
                                    <button
                                      key={ratio}
                                      onClick={() => setArchiveLayoutRatio(ratio)}
                                      className={`p-1 rounded transition-all cursor-pointer border flex flex-col items-center justify-center ${
                                        active 
                                          ? "bg-zinc-900 border-zinc-950 text-white shadow-[0_2px_8px_rgba(0,0,0,0.015)]" 
                                          : "bg-white border-zinc-250 text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50 hover:border-zinc-300"
                                      }`}
                                      title={
                                        ratio === "standard" ? "默认双栏比例 (3:2)" :
                                        ratio === "equal" ? "等宽双栏比对 (5:5)" :
                                        ratio === "immersive" ? "沉浸报告宽屏 (3:7)" : "满屏纯报告阅读"
                                      }
                                    >
                                      <div className="w-8 h-4 flex items-center gap-0.5 pointer-events-none">
                                        {ratio === "standard" && (
                                          <>
                                            <div className={`h-full rounded-sm ${active ? 'bg-white/30' : 'bg-zinc-200'} w-[60%]`} />
                                            <div className={`h-full rounded-sm ${active ? 'bg-white' : 'bg-blue-500'} w-[40%]`} />
                                          </>
                                        )}
                                        {ratio === "equal" && (
                                          <>
                                            <div className={`h-full rounded-sm ${active ? 'bg-white/30' : 'bg-zinc-200'} w-[50%]`} />
                                            <div className={`h-full rounded-sm ${active ? 'bg-white' : 'bg-blue-500'} w-[50%]`} />
                                          </>
                                        )}
                                        {ratio === "immersive" && (
                                          <>
                                            <div className={`h-full rounded-sm ${active ? 'bg-white/30' : 'bg-zinc-200'} w-[30%]`} />
                                            <div className={`h-full rounded-sm ${active ? 'bg-white' : 'bg-blue-500'} w-[70%]`} />
                                          </>
                                        )}
                                        {ratio === "fullscreen" && (
                                          <div className={`h-full rounded-sm ${active ? 'bg-white' : 'bg-blue-500'} w-full`} />
                                        )}
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            <div className="flex items-center gap-2 self-end md:self-auto shrink-0">
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(activeRec.report);
                                  alert("✓ 该归档分析报告已复制到剪贴板！");
                                }}
                                className="bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold px-3 py-1.5 rounded text-[11px] transition-colors cursor-pointer flex items-center gap-1 hover:text-zinc-950 border border-zinc-200"
                              >
                                <Copy className="w-3.5 h-3.5 text-zinc-500" />
                                <span>复制报告</span>
                              </button>

                              <button
                                onClick={() => handleRestoreRecord(activeRec)}
                                className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:from-blue-700 active:to-indigo-700 text-white font-bold px-4 py-1.5 rounded-2xl text-[11px] shadow-[0_2px_8px_rgba(0,0,0,0.015)] shadow-blue-500/10 hover:shadow-[0_4px_16px_rgba(0,0,0,0.025)] hover:shadow-blue-500/15 duration-200 transition-all duration-300 ease-out hover:scale-[1.006] active:scale-[0.99] gpu-accelerated active:scale-95 cursor-pointer flex items-center gap-1.5 border border-blue-600/20"
                                id="btn-restore-record-to-workbench"
                                title="一键将此历史备份曲线的数据配置条件还原拉回调试工作台"
                              >
                                <RotateCcw className="w-3.5 h-3.5 animate-spin-once text-blue-100" />
                                <span>还原至工作台</span>
                              </button>
                            </div>
                          </div>

                          {/* Dynamic 2-Column Split proportion wrapper */}
                          <div className={layout.container}>
                            
                            {/* Left panel element */}
                            <div className={layout.left}>
                              
                              {/* Chart wrapper */}
                              <div className="bg-white rounded-2xl border border-zinc-200 p-4 shadow-[0_2px_8px_rgba(0,0,0,0.015)] flex-1 flex flex-col justify-between min-h-[340px]">
                                <div className="pb-2 border-b border-zinc-100 flex items-center justify-between col-span-full shrink-0">
                                  <span className="font-bold text-[10px] text-zinc-500 uppercase tracking-wide">
                                    历史实验波形数据图
                                  </span>
                                </div>
                                <div className="flex-1 py-4 flex items-center justify-center min-h-[260px] bg-white">
                                  {renderRecordChart(activeRec)}
                                </div>
                              </div>

                              {/* Params cards */}
                              <div className="bg-white rounded-2xl border border-zinc-200 p-4 shadow-[0_2px_8px_rgba(0,0,0,0.015)] shrink-0">
                                <span className="font-bold text-[10px] text-zinc-500 block mb-2 uppercase tracking-wide">该样品工艺拟合补充参数</span>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 p-1.5 text-xs text-zinc-600 bg-zinc-50 rounded-2xl">
                                  <div className="p-1 px-2">
                                    <span className="text-[9.5px] text-zinc-400 font-bold block">工作电极有效表面积:</span>
                                    <span className="font-bold text-zinc-800 text-[11px]">{activeRec.params?.electrodeArea || "1.0"} cm²</span>
                                  </div>
                                  <div className="p-1 px-2">
                                    <span className="text-[9.5px] text-zinc-400 font-bold block">电极活性材料质量:</span>
                                    <span className="font-bold text-zinc-800 text-[11px]">{activeRec.params?.activeMass || "1.0"} mg</span>
                                  </div>
                                  {activeRec.dataType === "CV" && (
                                    <div className="p-1 px-2">
                                      <span className="text-[9.5px] text-zinc-400 font-bold block">电位扫描速度:</span>
                                      <span className="font-bold text-zinc-800 text-[11px]">{activeRec.params?.scanRate ? `${activeRec.params?.scanRate} mV/s` : (detectScanRate(activeRec.fileName, activeRec.rawTextData) ? `${detectScanRate(activeRec.fileName, activeRec.rawTextData)} mV/s` : "50 mV/s")}</span>
                                    </div>
                                  )}
                                  {activeRec.dataType === "GCD" && (
                                    <div className="p-1 px-2">
                                      <span className="text-[9.5px] text-zinc-400 font-bold block">放电测试电流:</span>
                                      <span className="font-bold text-zinc-800 text-[11px]">{activeRec.params?.dischargeCurrent || "1.0"} mA</span>
                                    </div>
                                  )}
                                  {activeRec.dataType === "EIS" && (
                                    <div className="p-1 px-2">
                                      <span className="text-[9.5px] text-zinc-400 font-bold block">直流偏置电压 Bias:</span>
                                      <span className="font-bold text-zinc-800 text-[11px]">{activeRec.params?.dcBias || "0.0"} V</span>
                                    </div>
                                  )}
                                  {activeRec.params?.equivalentCircuit && activeRec.dataType === "EIS" && (
                                    <div className="p-1 px-2 md:col-span-1">
                                      <span className="text-[9.5px] text-zinc-400 font-bold block">等效阻抗拟合电路 Formula:</span>
                                      <span className="font-bold text-zinc-800 text-[11px] truncate block" title={activeRec.params?.equivalentCircuit}>
                                        {activeRec.params?.equivalentCircuit}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </div>

                            </div>

                            {/* Right panel element: Analysis Report container */}
                            <div className={`${layout.right} bg-white rounded-2xl border border-zinc-200 shadow-[0_2px_8px_rgba(0,0,0,0.015)] p-4 flex flex-col h-full min-h-[440px]`}>
                              <span className="font-bold text-[11px] text-zinc-700 block pb-2 border-b border-zinc-100 mb-3 shrink-0 uppercase tracking-wide">
                                归档单品 AI 电化学诊断报告
                              </span>
                              <div className="flex-1 overflow-y-auto pr-1 text-left min-h-[320px]">
                                <div className="prose prose-slate max-w-none text-[11px] leading-relaxed prose-headings:text-zinc-800 prose-headings:font-bold prose-headings:mt-4 prose-strong:text-zinc-900 prose-ul:my-1 prose-p:my-2">
                                  <ReactMarkdown rehypePlugins={[rehypeRaw]}>{activeRec.report}</ReactMarkdown>
                                </div>
                                {activeRec.chartData && activeRec.chartData.length > 0 && (
                                  <div className="pt-3 border-t border-zinc-100 mt-4">
                                    <button
                                      onClick={() => {
                                        const name = activeRec.fileName ? activeRec.fileName.replace(/\.[^/.]+$/, "") : "archived_data";
                                        exportCurvesToCSV([{
                                          name: name,
                                          dataType: activeRec.dataType,
                                          data: activeRec.chartData || []
                                        }], `${name}_origin_export.csv`);
                                      }}
                                      className="w-full bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 hover:border-zinc-300 text-zinc-700 active:bg-zinc-200 duration-200 transition-all duration-300 ease-out hover:scale-[1.006] active:scale-[0.99] gpu-accelerated font-bold py-2 rounded-2xl text-[10.5px] flex items-center justify-center gap-1.5 cursor-pointer shadow-[0_2px_8px_rgba(0,0,0,0.015)] hover:shadow active:scale-95 text-center animate-in fade-in"
                                      title="导出该归档电化学曲线数据至标准的 CSV 文件，支持在 Origin、Excel 中一键导入二次绘图"
                                      id="btn-export-archived-csv"
                                    >
                                      <Download className="w-3.5 h-3.5 text-blue-600 animate-pulse" />
                                      <span>导出当前归档数据为 CSV (Origin/Excel)</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>

                          </div>
                        </div>
                      );
                    })()
                  )}
                </main>
              </div>
            );
          })()
        )}
      </div>

      {/* Parameter Dialog Modal Overlay */}
      {isParamsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/10 backdrop-blur-md p-4 transition-all duration-300 ease-out">
          <div className="bg-white/95 backdrop-blur-xl rounded-[16px] shadow-[0_20px_60px_rgba(0,0,0,0.08)] w-full max-w-lg border border-white/60 overflow-hidden transform transition-all duration-300 ease-out scale-100 opacity-100 text-zinc-800 flex flex-col max-h-[85vh]">
            <div className="px-6 py-5 flex justify-between items-center border-b border-zinc-100/50 bg-white/50">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center">
                  <Settings className="w-4 h-4 text-blue-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-[15px] tracking-tight text-zinc-800">实验参数补充与校准</h3>
                  <p className="text-[11px] text-zinc-500 mt-0.5">补充真实的测试条件，提升 AI 分析的物理精准度</p>
                </div>
              </div>
              <button 
                onClick={() => setIsParamsOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-100 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 transition-colors"
                id="btn-close-params"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto text-left flex-1 custom-scrollbar">
              <div className="flex items-center justify-between mb-6 p-3 bg-zinc-50/80 rounded-xl border border-zinc-100">
                <span className="font-medium text-[12px] text-zinc-600">当前激活模型</span>
                <span className="px-2.5 py-1 bg-blue-500/10 text-blue-600 rounded-lg font-semibold text-[11px]">
                  {dataType === "Auto" ? `自动识别（${activeType}）` : `${activeType} 模式`}
                </span>
              </div>

              <div className="space-y-6">
                {/* 1. 通用体系参数 */}
                <section>
                  <h4 className="text-[11px] font-bold text-zinc-400 tracking-wider uppercase mb-3 flex items-center gap-2">
                    <div className="w-1 h-3 bg-zinc-300 rounded-full"></div>
                    基础电化学体系配置
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-medium text-zinc-600">电解液 (Electrolyte)</label>
                      <input
                        type="text"
                        value={supplementaryParams.electrolyte}
                        onChange={(e) => setSupplementaryParams({ ...supplementaryParams, electrolyte: e.target.value })}
                        className="w-full text-xs px-3 py-2 bg-zinc-50 border border-zinc-200/60 rounded-xl focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all"
                        placeholder="例：6M KOH, 1M H2SO4"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-medium text-zinc-600">参比电极 (Ref. Electrode)</label>
                      <input
                        type="text"
                        value={supplementaryParams.referenceElectrode}
                        onChange={(e) => setSupplementaryParams({ ...supplementaryParams, referenceElectrode: e.target.value })}
                        className="w-full text-xs px-3 py-2 bg-zinc-50 border border-zinc-200/60 rounded-xl focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all"
                        placeholder="例：Ag/AgCl, SCE"
                      />
                    </div>
                  </div>
                </section>

                {/* 2. 电极规格参数 */}
                <section>
                  <h4 className="text-[11px] font-bold text-zinc-400 tracking-wider uppercase mb-3 flex items-center gap-2">
                    <div className="w-1 h-3 bg-zinc-300 rounded-full"></div>
                    电极物理参数
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-medium text-zinc-600">工作电极面积 (Area)</label>
                      <div className="relative">
                        <input
                          type="number"
                          step="any"
                          value={supplementaryParams.electrodeArea}
                          onChange={(e) => setSupplementaryParams({ ...supplementaryParams, electrodeArea: e.target.value })}
                          className="w-full text-xs px-3 py-2 bg-zinc-50 border border-zinc-200/60 rounded-xl focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all pr-10"
                          placeholder="例：1.0"
                        />
                        <span className="absolute right-3 top-2 text-[10px] text-zinc-400 font-medium">cm²</span>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-medium text-zinc-600">活性物质量 (Active Mass)</label>
                      <div className="relative">
                        <input
                          type="number"
                          step="any"
                          value={supplementaryParams.activeMass}
                          onChange={(e) => setSupplementaryParams({ ...supplementaryParams, activeMass: e.target.value })}
                          className="w-full text-xs px-3 py-2 bg-zinc-50 border border-zinc-200/60 rounded-xl focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all pr-10"
                          placeholder="例：1.5"
                        />
                        <span className="absolute right-3 top-2 text-[10px] text-zinc-400 font-medium">mg</span>
                      </div>
                    </div>
                  </div>
                </section>

                {/* 3. 方法专属参数 */}
                <section>
                  <h4 className="text-[11px] font-bold text-zinc-400 tracking-wider uppercase mb-3 flex items-center gap-2">
                    <div className="w-1 h-3 bg-blue-300 rounded-full"></div>
                    {activeType} 专属测试条件
                  </h4>
                  
                  {activeType === "CV" && (
                    <div className="grid grid-cols-2 gap-4 bg-blue-50/30 p-4 rounded-xl border border-blue-100/50">
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-medium text-zinc-700">扫描速率 (Scan Rate, v)</label>
                        <div className="relative">
                          <input
                            type="number"
                            step="any"
                            value={supplementaryParams.scanRate}
                            onChange={(e) => setSupplementaryParams({ ...supplementaryParams, scanRate: e.target.value })}
                            className="w-full text-xs px-3 py-2 bg-white border border-zinc-200/60 rounded-xl focus:border-blue-400 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all pr-12"
                            placeholder="自适应"
                          />
                          <span className="absolute right-3 top-2 text-[10px] text-zinc-400 font-medium">mV/s</span>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-medium text-zinc-700">电压窗口 (Voltage Window)</label>
                        <div className="relative">
                          <input
                            type="text"
                            value={supplementaryParams.voltageWindow}
                            onChange={(e) => setSupplementaryParams({ ...supplementaryParams, voltageWindow: e.target.value })}
                            className="w-full text-xs px-3 py-2 bg-white border border-zinc-200/60 rounded-xl focus:border-blue-400 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all pr-8"
                            placeholder="例：-0.2 ~ 0.8"
                          />
                          <span className="absolute right-3 top-2 text-[10px] text-zinc-400 font-medium">V</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeType === "GCD" && (
                    <div className="grid grid-cols-2 gap-4 bg-emerald-50/30 p-4 rounded-xl border border-emerald-100/50">
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-medium text-zinc-700">充放电电流 (Current, I)</label>
                        <div className="relative">
                          <input
                            type="number"
                            step="any"
                            value={supplementaryParams.dischargeCurrent}
                            onChange={(e) => setSupplementaryParams({ ...supplementaryParams, dischargeCurrent: e.target.value })}
                            className="w-full text-xs px-3 py-2 bg-white border border-zinc-200/60 rounded-xl focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 focus:outline-none transition-all pr-10"
                            placeholder="例：1.0"
                          />
                          <span className="absolute right-3 top-2 text-[10px] text-zinc-400 font-medium">mA</span>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-medium text-zinc-700">电压窗口 (Voltage Window)</label>
                        <div className="relative">
                          <input
                            type="text"
                            value={supplementaryParams.voltageWindow}
                            onChange={(e) => setSupplementaryParams({ ...supplementaryParams, voltageWindow: e.target.value })}
                            className="w-full text-xs px-3 py-2 bg-white border border-zinc-200/60 rounded-xl focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 focus:outline-none transition-all pr-8"
                            placeholder="例：0 ~ 1.0"
                          />
                          <span className="absolute right-3 top-2 text-[10px] text-zinc-400 font-medium">V</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeType === "EIS" && (
                    <div className="grid grid-cols-2 gap-4 bg-amber-50/30 p-4 rounded-xl border border-amber-100/50">
                      <div className="col-span-2 space-y-1.5">
                        <label className="text-[11px] font-medium text-zinc-700">预置等效电路 (Equivalent Circuit)</label>
                        <input
                          type="text"
                          value={supplementaryParams.equivalentCircuit}
                          onChange={(e) => setSupplementaryParams({ ...supplementaryParams, equivalentCircuit: e.target.value })}
                          className="w-full text-xs px-3 py-2 bg-white border border-zinc-200/60 rounded-xl focus:border-amber-400 focus:ring-2 focus:ring-amber-100 focus:outline-none transition-all font-mono"
                          placeholder="例：Rs + Cdl // (Rct + Zw)"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-medium text-zinc-700">频率范围 (Freq Range)</label>
                        <input
                          type="text"
                          value={supplementaryParams.frequencyRange}
                          onChange={(e) => setSupplementaryParams({ ...supplementaryParams, frequencyRange: e.target.value })}
                          className="w-full text-xs px-3 py-2 bg-white border border-zinc-200/60 rounded-xl focus:border-amber-400 focus:ring-2 focus:ring-amber-100 focus:outline-none transition-all"
                          placeholder="例：100kHz-0.01Hz"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-medium text-zinc-700">交流振幅 (AC Amp)</label>
                        <div className="relative">
                          <input
                            type="number"
                            step="any"
                            value={supplementaryParams.acAmplitude}
                            onChange={(e) => setSupplementaryParams({ ...supplementaryParams, acAmplitude: e.target.value })}
                            className="w-full text-xs px-3 py-2 bg-white border border-zinc-200/60 rounded-xl focus:border-amber-400 focus:ring-2 focus:ring-amber-100 focus:outline-none transition-all pr-10"
                            placeholder="例：5"
                          />
                          <span className="absolute right-3 top-2 text-[10px] text-zinc-400 font-medium">mV</span>
                        </div>
                      </div>
                      <div className="col-span-2 space-y-1.5">
                        <label className="text-[11px] font-medium text-zinc-700">直流偏置电压 (DC Bias)</label>
                        <div className="relative">
                          <input
                            type="number"
                            step="any"
                            value={supplementaryParams.dcBias}
                            onChange={(e) => setSupplementaryParams({ ...supplementaryParams, dcBias: e.target.value })}
                            className="w-full text-xs px-3 py-2 bg-white border border-zinc-200/60 rounded-xl focus:border-amber-400 focus:ring-2 focus:ring-amber-100 focus:outline-none transition-all pr-8"
                            placeholder="例：0.0"
                          />
                          <span className="absolute right-3 top-2 text-[10px] text-zinc-400 font-medium">V</span>
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              </div>
            </div>
            
            <div className="p-5 border-t border-zinc-100/50 bg-zinc-50/50 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsParamsOpen(false)}
                className="px-5 py-2.5 bg-white border border-zinc-200 hover:bg-zinc-100 text-zinc-700 text-xs font-semibold rounded-xl transition-all duration-200 active:scale-95"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => setIsParamsOpen(false)}
                className="px-6 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold rounded-xl shadow-md shadow-zinc-900/10 transition-all duration-200 active:scale-95"
                id="btn-save-params"
              >
                应用参数并关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User Guide Floating Modal Popover */}
      <AnimatePresence>
        {isGuideOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsGuideOpen(false)}
              className="fixed inset-0 bg-black/45 backdrop-blur-sm"
            />

            {/* Modal Panel */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="relative w-full max-w-4xl h-[85vh] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.1)] flex flex-col z-10 rounded-2xl border border-zinc-200 overflow-hidden"
            >
              {/* Header */}
              <div className="bg-zinc-900 text-white px-5 py-4 flex justify-between items-center shrink-0">
                <div className="flex items-center gap-2.5">
                  <BookOpen className="w-4.5 h-4.5 text-zinc-200" />
                  <div>
                    <h3 className="font-display font-bold text-sm tracking-wide text-white">系统使用指南 & 技术手册</h3>
                    <p className="text-[9.5px] text-zinc-400 font-normal mt-0.5">多快通道电化学通用深度拟合与机理推演说明</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsGuideOpen(false)}
                  className="p-1 hover:bg-white/10 text-zinc-400 hover:text-white rounded-lg transition-colors cursor-pointer"
                  id="btn-close-guide"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Master Split Body */}
              <div className="flex flex-1 overflow-hidden">
                {/* Left Mini-Bar: Table of Contents */}
                <div className="w-[180px] border-r border-zinc-100 bg-zinc-50/50 p-3 overflow-y-auto shrink-0 flex flex-col gap-5 text-left select-none font-sans scrollbar-thin">
                  <div>
                    <span className="text-[9.5px] font-bold text-zinc-400 tracking-wider uppercase px-2 mb-2 block">1. 介绍体系</span>
                    <div className="space-y-0.5">
                      <button 
                        onClick={() => scrollToSection('guide-sec-intro')}
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-zinc-100/90 text-[10.5px] font-medium text-zinc-600 hover:text-zinc-900 transition-colors duration-150 cursor-pointer"
                      >
                        ⚡ 系统概览
                      </button>
                    </div>
                  </div>

                  <div>
                    <span className="text-[9.5px] font-bold text-zinc-400 tracking-wider uppercase px-2 mb-2 block">2. 核心分析能力</span>
                    <div className="space-y-0.5">
                      <button 
                        onClick={() => scrollToSection('guide-sec-cv')}
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-zinc-100/90 text-[10.5px] font-medium text-zinc-600 hover:text-zinc-900 transition-colors duration-150 cursor-pointer"
                      >
                        📈 循环伏安法 (CV)
                      </button>
                      <button 
                        onClick={() => scrollToSection('guide-sec-gcd')}
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-zinc-100/90 text-[10.5px] font-medium text-zinc-600 hover:text-zinc-900 transition-colors duration-150 cursor-pointer"
                      >
                        ⚡ 恒流充放电 (GCD)
                      </button>
                      <button 
                        onClick={() => scrollToSection('guide-sec-eis')}
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-zinc-100/90 text-[10.5px] font-medium text-zinc-600 hover:text-zinc-900 transition-colors duration-150 cursor-pointer"
                      >
                        🧬 阻抗电化学 (EIS)
                      </button>
                    </div>
                  </div>

                  <div>
                    <span className="text-[9.5px] font-bold text-zinc-400 tracking-wider uppercase px-2 mb-2 block">3. 极速操作模式</span>
                    <div className="space-y-0.5">
                      <button 
                        onClick={() => scrollToSection('guide-sec-step-upload')}
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-zinc-100/90 text-[10.5px] font-medium text-zinc-600 hover:text-zinc-900 transition-colors duration-150 cursor-pointer"
                      >
                        📥 数据与图像载入
                      </button>
                      <button 
                        onClick={() => scrollToSection('guide-sec-step-params')}
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-zinc-100/90 text-[10.5px] font-medium text-zinc-600 hover:text-zinc-900 transition-colors duration-150 cursor-pointer"
                      >
                        ⚙️ 工艺参数补充
                      </button>
                      <button 
                        onClick={() => scrollToSection('guide-sec-step-analyze')}
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-zinc-100/90 text-[10.5px] font-medium text-zinc-600 hover:text-zinc-900 transition-colors duration-150 cursor-pointer"
                      >
                        🔮 启动深度拟合
                      </button>
                    </div>
                  </div>

                  <div>
                    <span className="text-[9.5px] font-bold text-zinc-400 tracking-wider uppercase px-2 mb-2 block">4. 数据精加工</span>
                    <div className="space-y-0.5">
                      <button 
                        onClick={() => scrollToSection('guide-sec-feat-smooth')}
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-zinc-100/90 text-[10.5px] font-medium text-zinc-600 hover:text-zinc-900 transition-colors duration-150 cursor-pointer"
                      >
                        🧼 平滑滤波去噪
                      </button>
                      <button 
                        onClick={() => scrollToSection('guide-sec-feat-zoom')}
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-zinc-100/90 text-[10.5px] font-medium text-zinc-600 hover:text-zinc-900 transition-colors duration-150 cursor-pointer"
                      >
                        🔍 矩形变焦与平移
                      </button>
                      <button 
                        onClick={() => scrollToSection('guide-sec-feat-origin')}
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-zinc-100/90 text-[10.5px] font-medium text-zinc-600 hover:text-zinc-900 transition-colors duration-150 cursor-pointer"
                      >
                        📤 一键 Origin 导出
                      </button>
                    </div>
                  </div>

                  <div>
                    <span className="text-[9.5px] font-bold text-zinc-400 tracking-wider uppercase px-2 mb-2 block">5. 项目管理与比对</span>
                    <div className="space-y-0.5">
                      <button 
                        onClick={() => scrollToSection('guide-sec-archive')}
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-zinc-100/90 text-[10.5px] font-medium text-zinc-600 hover:text-zinc-900 transition-colors duration-150 cursor-pointer"
                      >
                        📁 项目分类归档
                      </button>
                      <button 
                        onClick={() => scrollToSection('guide-sec-compare')}
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-zinc-100/90 text-[10.5px] font-medium text-zinc-600 hover:text-zinc-900 transition-colors duration-150 cursor-pointer"
                      >
                        📊 多曲线对比叠图
                      </button>
                    </div>
                  </div>

                  <div>
                    <span className="text-[9.5px] font-bold text-zinc-400 tracking-wider uppercase px-2 mb-2 block">6. 自定义引擎</span>
                    <div className="space-y-0.5">
                      <button 
                        onClick={() => scrollToSection('guide-sec-custom-api')}
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-zinc-100/90 text-[10.5px] font-medium text-zinc-600 hover:text-zinc-900 transition-colors duration-150 cursor-pointer"
                      >
                        ⚙️ 自定义大模型接口
                      </button>
                    </div>
                  </div>
                </div>

                {/* Right Area: Document Content */}
                <div className="flex-1 p-5 overflow-y-auto text-left text-[11px] text-zinc-600 leading-relaxed font-sans scroll-smooth space-y-6 scrollbar-thin">
                  {/* System Overview */}
                  <section id="guide-sec-intro" className="space-y-2 border-b border-zinc-100 pb-5">
                    <h4 className="text-xs font-bold text-zinc-900 flex items-center gap-1.5">
                      <span className="w-1.5 h-3 bg-zinc-900 rounded-sm"></span>
                      <span>1.0 电化学智能分析系统简介</span>
                    </h4>
                    <p className="text-zinc-500">
                      本系统是一款专为新能源电池、催化、电容器及腐蚀电化学研究打造的标准级 **电化学数据一站式智能分析工作台**。系统深度集成了先进的信息数值处理算法与端到端大语言模型，能实现对多源实验物理文件的“自适应快速识别”，免去在第三方绘图软件中繁琐的数据处理和参数拟合计算操作。
                    </p>
                    <p className="text-zinc-500">
                      上传 CV、GCD、EIS 的多列原始数据文件（如 txt/csv 格式）或直接拖入图表物理图像，本系统便能在秒级内逆向重构曲线离散点，自动提取极值电位、极化电压降和系统本征阻抗，并在右侧报告栏一键生成极具学术水平的中文机理分析研判。
                    </p>
                  </section>

                  {/* Test Capabilities */}
                  <section id="guide-sec-cv" className="space-y-2 border-b border-zinc-100 pb-5">
                    <h4 className="text-xs font-bold text-zinc-900 flex items-center gap-1.5">
                      <span className="w-1.5 h-3 bg-blue-600 rounded-sm"></span>
                      <span>2.1 循环伏安法 (CV) 深度分析</span>
                    </h4>
                    <p className="text-zinc-500 font-semibold text-zinc-800">
                      **电极表界面存储动力学及可逆性测评：**
                    </p>
                    <ul className="list-disc pl-4 space-y-1 text-zinc-500">
                      <li>**电容量微积分积分**：沿对称电平扫描环轨迹，系统通过精细梯形数值微积分估算循环特征区间的准平衡面积，实时解算表面比容量和总功能级。</li>
                      <li>**氧化还原极化识别**：精准剥离正反双向最大氧化峰与还原峰值电流（Ip）、对应极化电压跃变点（Ep）以及阴阳极势差（ΔEp），定量判定全极化系统的非对称可逆因子。</li>
                      <li>**扫速动力学扩展分析**：若预设工艺扫速，可结合特征幂律等物理模型，对控制机制（半无限电位扩散控制 vs 表面受限伪电容控制）进行物理贡献率解离。</li>
                    </ul>
                  </section>

                  <section id="guide-sec-gcd" className="space-y-2 border-b border-zinc-100 pb-5">
                    <h4 className="text-xs font-bold text-zinc-900 flex items-center gap-1.5">
                      <span className="w-1.5 h-3 bg-amber-500 rounded-sm"></span>
                      <span>2.2 恒流充放电 (GCD) 深度分析</span>
                    </h4>
                    <p className="text-zinc-500 font-semibold text-zinc-800">
                      **全生命周期放电比容量与能量损耗研判：**
                    </p>
                    <ul className="list-disc pl-4 space-y-1 text-zinc-500">
                      <li>**精确比电容/比容量量化**：结合补充的工作电极活性载量及充放区间，求解 Q = I · Δt 并实时输出质量比电容（F/g 或 mAh/g）。</li>
                      <li>**高频瞬间欧姆降 (IR drop)**：利用放电首端微秒级切向突变导数，智能分离接触电阻与溶液阻值所产生的内阻压降，助力提升薄膜电池/储能器件电极导电性。</li>
                      <li>**非线性库伦响应**：自适应测算放电时间与充电时间的标定量比值，评估电极在特定工作电流下的库伦效率。</li>
                    </ul>
                  </section>

                  <section id="guide-sec-eis" className="space-y-2 border-b border-zinc-100 pb-5">
                    <h4 className="text-xs font-bold text-zinc-900 flex items-center gap-1.5">
                      <span className="w-1.5 h-3 bg-emerald-500 rounded-sm"></span>
                      <span>2.3 电化学阻抗谱 (EIS) 深度分析</span>
                    </h4>
                    <p className="text-zinc-500 font-semibold text-zinc-800">
                      **表界面电荷传递速率与离子电导率微观分析：**
                    </p>
                    <ul className="list-disc pl-4 space-y-1 text-zinc-500">
                      <li>**Nyquist 谱图快速还原**：对复阻抗 Z' (实部电阻) 与 Z" (虚部电抗) 构筑标准高宽比正方形物理坐标空间（防止人为视觉形变）。</li>
                      <li>**本征阻抗分量解离**：敏锐捕捉高频起步截点 Rs（电解液欧姆电阻）、中低频圆心极值 Rct（双电层电荷转移电阻）及 Warburg 低角扩散矢量（离子跃迁动力学系数）。</li>
                      <li>**等效电路拟合建议**：智能匹配经典的 Randall 并联拓扑模型，给出半经典常相位角元件（CPE）设定和电导率拟合估算。</li>
                    </ul>
                  </section>

                  {/* Operation Guide */}
                  <section id="guide-sec-step-upload" className="space-y-2 border-b border-zinc-100 pb-5">
                    <h4 className="text-xs font-bold text-zinc-900 flex items-center gap-1.5">
                      <span className="w-1.5 h-3 bg-indigo-600 rounded-sm"></span>
                      <span>3.1 极简数据与图像载入</span>
                    </h4>
                    <p className="text-zinc-500">
                      在实验工作台底层的双孔多模态载入卡片中，您可以：
                    </p>
                    <div className="bg-zinc-50 p-2.5 rounded border border-zinc-100/80 space-y-2 text-[10px] text-zinc-500">
                      <p>**方式一：拖入文本表格数据**：可选择绝大多数国产/进口工作站导出的 txt、csv、dat 格式。内置表头对齐引擎将瞬间抽取核心列进行二维离散构图。</p>
                      <p>**方式二：直接上传带有坐标系的曲线截屏**：无源图像自提取。支持上传多格式曲线图像，AI 图解网络将在 1.5 秒内自动逆构、标定交叉辅助线并恢复出完整高保真点阵！</p>
                    </div>
                  </section>

                  <section id="guide-sec-step-params" className="space-y-2 border-b border-zinc-100 pb-5">
                    <h4 className="text-xs font-bold text-zinc-900 flex items-center gap-1.5">
                      <span className="w-1.5 h-3 bg-red-400 rounded-sm"></span>
                      <span>3.2 精细工艺与材料参数预设</span>
                    </h4>
                    <p className="text-zinc-500">
                      数据读入后，要想得出高可用的比特性、阻值及极限速率比，请立刻点击图像下侧的 **[参数补充]** 浮窗。在其中：
                    </p>
                    <ul className="list-disc pl-4 space-y-1 text-zinc-505 text-zinc-500">
                      <li>**接触电极面积 S (cm²)**：直接关乎极化表面电流密度的分母基准。</li>
                      <li>**电极活性载量 M (mg)**：测算材料比物理参数、质量比容量不可缺少的权重比输入。</li>
                      <li>**专属模式系数**：视类别指定特定阻抗电路Rs架构或指定恒流 GCD 电流数值。</li>
                    </ul>
                  </section>

                  <section id="guide-sec-step-analyze" className="space-y-2 border-b border-zinc-100 pb-5">
                    <h4 className="text-xs font-bold text-zinc-900 flex items-center gap-1.5">
                      <span className="w-1.5 h-3 bg-violet-600 rounded-sm"></span>
                      <span>3.3 开启单品/批次深度拟合分析</span>
                    </h4>
                    <p className="text-zinc-500">
                      核对无误后，点击左下侧高亮瞩目的 **[开始深度拟合分析]**。
                    </p>
                    <p className="text-zinc-500">
                      系统主引擎首先启动多阶几何极值检索与常系数微积分计算，随后将物理特征、曲线斜率和微观指标全量上传。AI 求解器进行多维度交叉演绎，输出符合高水平 SCI 学术论文发表规范的详细中文报告。您可在右侧 [分析报告摘要] 面板阅读、一键打包复制成果及导出 CSV 数据。
                    </p>
                  </section>

                  {/* Feature Highlights */}
                  <section id="guide-sec-feat-smooth" className="space-y-2 border-b border-zinc-100 pb-5">
                    <h4 className="text-xs font-bold text-zinc-900 flex items-center gap-1.5">
                      <span className="w-1.5 h-3 bg-teal-600 rounded-sm"></span>
                      <span>4.1 多阶平滑滤波除噪</span>
                    </h4>
                    <p className="text-zinc-500">
                      电化学工作站采集原始曲线时，易受高低频强电干扰、粉体材料高内阻自极化或机械微量振动影响，波形边缘往往携带强干扰毛刺噪声（如锯齿波抖动）。
                    </p>
                    <p className="text-zinc-500">
                      我们在图表面板下方搭载了 **[平滑滤波 (滑动平均平滑去噪)]** 快筛。一键启动后，算法将在保留拐点极值、起始扫描斜值和极化相位的前提下自动滤除电位噪点，让最终数据比容量重组更平顺、更精确！
                    </p>
                  </section>

                  <section id="guide-sec-feat-zoom" className="space-y-2 border-b border-zinc-100 pb-5">
                    <h4 className="text-xs font-bold text-zinc-900 flex items-center gap-1.5">
                      <span className="w-1.5 h-3 bg-cyan-600 rounded-sm"></span>
                      <span>4.2 矩形变焦与平移精修细节</span>
                    </h4>
                    <p className="text-zinc-500">
                      为方便科研人员审视局部极细小的微量相变信号或电荷传递起始突跳：
                    </p>
                    <div className="bg-zinc-50 p-2.5 rounded border border-zinc-100 space-y-1.5 text-[10px] text-zinc-500">
                      <p>**A. 框选变焦**：在主可视化坐标平面内，按住鼠标 **左键** 并反向或正向拖拽出一个高亮选定框。释放后，图标视窗比例立即重画无损变焦此框定范围！</p>
                      <p>**B. 精密平移**：使用图表右下方的平移箭头快捷面板，可细微平移缩放后的微观迹线视窗。</p>
                      <p>**C. 一键还原**：随时点击图表右下方的 **[重置]** 旋钮即可回归标准比例全画幅图像。</p>
                    </div>
                  </section>

                  <section id="guide-sec-feat-origin" className="space-y-2 border-b border-zinc-100 pb-5">
                    <h4 className="text-xs font-bold text-zinc-900 flex items-center gap-1.5">
                      <span className="w-1.5 h-3 bg-pink-500 rounded-sm"></span>
                      <span>4.3 一键导出 Origin 标准拼对表格</span>
                    </h4>
                    <p className="text-zinc-500">
                      针对科研人员极其高频的数据美化与二次作图习惯：
                    </p>
                    <p className="text-zinc-500">
                      在报告框最下侧点击 **[导出当前数据 (Origin/Excel)]**。导出的 CSV 表格按标准的双列（X, Y）物理排布。如果是多组曲线比对，则将自动横向展开为 `A_X, A_Y, B_X, B_Y` 进行规整排列，完全免去了手动拷贝拼凑表格的麻烦，极速提效。
                    </p>
                  </section>

                  {/* Archives */}
                  <section id="guide-sec-archive" className="space-y-2 border-b border-zinc-100 pb-5">
                    <h4 className="text-xs font-bold text-zinc-900 flex items-center gap-1.5">
                      <span className="w-1.5 h-3 bg-rose-600 rounded-sm"></span>
                      <span>5.1 数据归档与分类项目管理</span>
                    </h4>
                    <p className="text-zinc-500">
                      在右侧栏 [项目与数据归档] 底层卡片中，您可以自主创建无限个多级分类课题工程（例如“富锂锰基正极材料 C 改性组”、“固态电解质大倍充 GCD”等）。
                    </p>
                    <p className="text-zinc-500">
                      每次分析获得学术报告后，均可在右侧弹出的保存输入栏内，为该样品物理迹点命名（如 “样品 A-10C扫速-3号样”），并选取归入您的指定工程，一键保存至本地，便于进行长期科研积淀和查阅。
                    </p>
                  </section>

                  <section id="guide-sec-compare" className="space-y-2 pb-2">
                    <h4 className="text-xs font-bold text-zinc-900 flex items-center gap-1.5">
                      <span className="w-1.5 h-3 bg-zinc-800 rounded-sm"></span>
                      <span>5.2 高通量叠图比对分析</span>
                    </h4>
                    <p className="text-zinc-500">
                      极客学者尊享功能。点击顶部 navbar 切换至 **[数据归档]** 独立窗口：
                    </p>
                    <p className="text-zinc-500">
                      在左侧栏中可**任意勾选多个已归档的异源/同源历史曲线记录**，将其横向叠加拼对在同一套自适应物理图层中表现及重合对比。
                    </p>
                    <p className="text-zinc-500">
                      顶部的 **[开始多样本叠图比对分析]** 会提取不同样品的工作差异，汇总为一份多样本对比报告，一键解算材料微观掺杂/条件优化对宏观电化学响应的实质规律！
                    </p>
                  </section>

                  {/* Custom API */}
                  <section id="guide-sec-custom-api" className="space-y-2 pb-2">
                    <h4 className="text-xs font-bold text-zinc-900 flex items-center gap-1.5">
                      <span className="w-1.5 h-3 bg-fuchsia-600 rounded-sm"></span>
                      <span>6. 自定义大模型接口 (Custom API)</span>
                    </h4>
                    <p className="text-zinc-500">
                      系统现已支持灵活无缝接入各类顶尖及开源大语言模型，赋予您对底层 AI 算力的最高控制权：
                    </p>
                    <ul className="list-disc pl-4 space-y-1 text-zinc-505 text-zinc-500">
                      <li>**内置 Gemini 2.5 视觉底座**：默认零配置直接启动官方预设通道。</li>
                      <li>**无缝切换多平台大模型**：点击侧边栏下方 **“自定义 API 接口”** 面板，开启后支持填入第三方 OpenAI 兼容格式接口 (如 DeepSeek, GPT-4o, Claude 3.5 等)。</li>
                      <li>**局域网私有化模型支持**：支持填写本地 Ollama 或 vLLM 的 `http://localhost:11434/v1` 等端点路径，保证最高级别的数据私密性。</li>
                      <li>**注意**：对于含有图片的识别，需确保配置的模型支持视觉多模态能力 (Vision)，否则将自动触发系统容错拦截。</li>
                    </ul>
                  </section>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
