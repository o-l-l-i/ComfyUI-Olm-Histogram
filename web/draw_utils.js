export function drawHistogramBackground(ctx, area, style) {
  ctx.save();
  ctx.fillStyle = style?.fillStyle || "#444";
  ctx.fillRect(area.x, area.y, area.width, area.height);
  ctx.strokeStyle = style?.strokeStyle || "#666";
  ctx.lineWidth = style?.lineWidth || 1;
  ctx.strokeRect(area.x, area.y, area.width, area.height);
  ctx.strokeStyle = style?.gridLineStyle || "rgba(255,255,255,0.1)";
  ctx.lineWidth = style?.gridLineWidth || 0.5;
  for (let i = 0; i <= area.grid_y; i++) {
    const y = area.y + i * (area.height / area.grid_y);
    ctx.beginPath();
    ctx.moveTo(area.x, y);
    ctx.lineTo(area.x + area.width, y);
    ctx.stroke();
  }
  for (let i = 0; i <= area.grid_x; i++) {
    const x = area.x + i * (area.width / area.grid_x);
    ctx.beginPath();
    ctx.moveTo(x, area.y);
    ctx.lineTo(x, area.y + area.height);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawBox(ctx, rect, style, label = "", labelStyle = {}) {
  ctx.save();
  ctx.fillStyle = style?.fillStyle || "#222";
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  if (style && style.strokeStyle) {
    ctx.strokeStyle = style.strokeStyle;
    ctx.lineWidth = style.lineWidth || 1;
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  }
  if (label) {
    ctx.fillStyle = labelStyle.fillStyle || "#FFF";
    ctx.font = labelStyle.font || "10px Arial";
    ctx.textAlign = labelStyle.textAlign || "left";
    ctx.textBaseline = labelStyle.textBaseline || "middle";
    const offsetX = labelStyle.offsetX || 5;
    const offsetY = labelStyle.offsetY || rect.height / 2;
    ctx.fillText(label, rect.x + offsetX, rect.y + offsetY);
  }
  ctx.restore();
}

export function drawMultilineText(ctx, text, x, y, style = {}) {
  ctx.save();
  ctx.fillStyle = style.fillStyle || "#FFF";
  ctx.font = style.font || "10px Arial";
  ctx.textAlign = style.textAlign || "left";
  ctx.textBaseline = style.textBaseline || "top";

  const lines = text.split("\n");
  const lineHeight = parseFloat(ctx.font) * 1.2;

  let currentY = y;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x, currentY);
    currentY += lineHeight;
  }
  ctx.restore();
}

export function drawBinLine(ctx, bin, x, y, width, height, color = "white") {
  if (bin < 0 || bin > 255) return;
  const binX = x + (bin / 255) * width;
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(binX, y);
  ctx.lineTo(binX, y + height);
  ctx.stroke();
}

export function smoothHistogram(histogram, windowSize = 5) {
  const radius = Math.floor(windowSize / 2);
  const result = new Array(histogram.length).fill(0);

  for (let i = 0; i < histogram.length; i++) {
    let sum = 0;
    let count = 0;

    for (
      let j = Math.max(0, i - radius);
      j <= Math.min(histogram.length - 1, i + radius);
      j++
    ) {
      sum += histogram[j];
      count++;
    }

    result[i] = sum / count;
  }

  return result;
}
