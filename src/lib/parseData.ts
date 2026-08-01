export function parseElectroData(fileContent: string, delimiter = ",") {
  // Replace multiple spaces with a single delimiter if it's space-separated, etc.
  // We'll use papaparse for robust parsing.

  // Normalize delimiters to comma if it's space or tab separated
  const normalized = fileContent.replace(/[\t ]+/g, ",");
  
  const rows = normalized.split('\n').map(row => row.trim()).filter(Boolean);
  
  type Point = { x: number; y: number };
  const data: Point[] = [];
  
  // Try to find the first row with purely numeric data to skip headers
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
