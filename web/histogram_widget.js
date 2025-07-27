import {
  drawHistogramBackground,
  drawBox,
  smoothHistogram,
  drawMultilineText,
  drawBinLine,
} from "./draw_utils.js";

import { rgbToHsl, rgbToLuminance } from "./color_utils.js";

const DRAW_STYLE_HOVER = {
  font: "9px monospace",
  fontColor: "#fff",
  boxColor: "rgba(0, 0, 0, 0.7)",
  boxStrokeColor: "#888",
  boxStrokeWidth: 1,
  textPaddingX: 5,
  textPaddingY: 5,
  histBoxWidth: 220,
  prevBoxWidth: 120,
  prevBoxHeight: 50,
  boxMargin: 8,
  lineHeight: 14,
  mouseOffsetX: 10,
  mouseOffsetY: 10,
};

const HISTOGRAM_CONFIG = {
  padding: 30,
  x: 15,
  y: 30,
  width: 320,
  height: 120,
  grid_x: 4,
  grid_y: 4,
};

const DRAW_STYLE_HISTOGRAM = {
  fillStyle: "#2C2C2C",
  strokeStyle: "#555",
  gridLineStyle: "rgba(255,255,255,0.08)",
};

const DRAW_STYLE_AXIS_LABELS = {
  font: "8px Arial",
  color: "#777",
};

const BUTTON_STYLE = {
  active: "#6a6a6a",
  inactive: "#3a3a3a",
  stroke: "#222",
  rowGap: 25,
  btnGap: 6,
};

const STATS_CONFIG = {
  x: 15,
  y: 220,
  boxWidth: 48,
  boxHeight: 15,
  gapX: 4,
  gapY: 12,
};

const DRAW_STYLE_STATS = {
  titleFont: "bold 7px Arial",
  titleFontColor: "#AAA",
  statFont: "7px Arial",
  fillStyle: "#242424",
};

const PREVIEW_STYLE = {
  lineColor: "#888",
  lineWidth: 1,
  fallbackColor: "#AAA",
  fallbackFont: "12px Arial",
  fallbackOffsetY: 10,
};

const PREVIEW_SETTINGS = {
  magicY: 330,
  maxPreviewHeight: 1024,
  padding: 15,
};

const BUTTONS_START_Y_MAGIC = 20;
const STATS_START_Y_MAGIC = 105;

export class HistogramWidget {
  constructor(node, onConfigChange) {
    this.node = node;
    this.onConfigChange = onConfigChange;

    this._smoothedHist = null;
    this._smoothDirty = true;

    this.histograms = null;
    this.stats = null;
    this.previewImage = null;
    this.previewCanvas = null;

    this.hoverPixelInfo = null;
    this.lastMousePos = null;

    this.config = {
      type: "luminance",
      scale: "linear",
      smooth: false,
      visibleChannels: { red: true, green: true, blue: true },
    };

    this.layout = { ...HISTOGRAM_CONFIG };
    this.buttons = [];
    this.rebuildButtons();
  }

  rebuildButtons() {
    this.buttons = [];

    const nodeW = this.node?.size?.[0] ?? 340;
    const rowGap = BUTTON_STYLE.rowGap;
    const btnGap = BUTTON_STYLE.btnGap;
    let baseY = this.layout.y + this.layout.height + BUTTONS_START_Y_MAGIC;

    const makeRow = (defs, y) => {
      const contentW = nodeW - HISTOGRAM_CONFIG.padding;
      const totalW =
        defs.reduce((s, d) => s + d.w, 0) + btnGap * (defs.length - 1);
      let startX =
        Math.round((contentW - totalW) / 2) + HISTOGRAM_CONFIG.padding / 2;
      defs.forEach((d) => {
        this.buttons.push({
          ...d,
          x: startX,
          y,
        });
        startX += d.w + btnGap;
      });
    };

    makeRow(
      [
        {
          id: "type_lum",
          label: "Luminance",
          w: 80,
          h: 20,
          active: this.config.type === "luminance",
        },
        {
          id: "type_rgb",
          label: "RGB",
          w: 55,
          h: 20,
          active: this.config.type === "rgb",
        },
        {
          id: "scale_lin",
          label: "Linear",
          w: 60,
          h: 20,
          active: this.config.scale === "linear",
        },
        {
          id: "scale_log",
          label: "Log",
          w: 45,
          h: 20,
          active: this.config.scale === "logarithmic",
        },
      ],
      baseY
    );

    baseY += rowGap;
    makeRow(
      [
        {
          id: "smooth_toggle",
          label: "Smooth",
          w: 70,
          h: 20,
          active: this.config.smooth,
        },
      ],
      baseY
    );

    if (this.config.type === "rgb") {
      baseY += rowGap;
      makeRow(
        [
          {
            id: "ch_red",
            label: "R",
            w: 30,
            h: 20,
            active: this.config.visibleChannels.red,
          },
          {
            id: "ch_green",
            label: "G",
            w: 30,
            h: 20,
            active: this.config.visibleChannels.green,
          },
          {
            id: "ch_blue",
            label: "B",
            w: 30,
            h: 20,
            active: this.config.visibleChannels.blue,
          },
        ],
        baseY
      );
    }
  }

  getPreviewDrawRect() {
    const nodeW = this.node?.size?.[0] ?? 340;
    const nodeH = this.node?.size?.[1] ?? 400;
    const padding = PREVIEW_SETTINGS.padding;
    const fallbackAspect = 1.5;

    const img = this.previewImage;
    const aspect =
      img && img.width && img.height ? img.width / img.height : fallbackAspect;

    const contentW = nodeW - padding * 2;
    let drawWidth = contentW;
    let drawHeight = drawWidth / aspect;

    const drawY = PREVIEW_SETTINGS.magicY;
    const availableHeight = nodeH - drawY - padding;
    const maxHeight = PREVIEW_SETTINGS.maxPreviewHeight;

    if (drawHeight > Math.min(maxHeight, availableHeight)) {
      drawHeight = Math.min(maxHeight, availableHeight);
      drawWidth = drawHeight * aspect;
    }

    const drawX = (nodeW - drawWidth) / 2;

    return {
      x: drawX,
      y: drawY,
      width: drawWidth,
      height: drawHeight,
    };
  }

  updateData(data) {
    if (data.histograms) {
      this.histograms = data.histograms;
      this._smoothDirty = true;
    }

    if (data.stats) {
      this.stats = data.stats;
    }

    if (data.preview_image) {
      const img = new Image();
      img.onload = () => {
        this.previewImage = img;

        if (!this.previewCanvas) {
          this.previewCanvas = document.createElement("canvas");
        }
        this.previewCanvas.width = img.width;
        this.previewCanvas.height = img.height;
        const ctx = this.previewCanvas.getContext("2d");
        ctx?.drawImage(img, 0, 0);

        this.node.setDirtyCanvas(true, true);
      };
      img.src = data.preview_image;
    }

    this.node.setDirtyCanvas(true, true);
  }

  updateConfig(newConfig) {
    Object.assign(this.config, newConfig);
    this._smoothDirty = true;
    this.rebuildButtons();
  }

  maybeRebuildSmoothing() {
    if (this._smoothDirty && this.config.smooth && this.histograms) {
      this._smoothedHist = {
        red: this.histograms.red ? smoothHistogram(this.histograms.red) : null,
        green: this.histograms.green
          ? smoothHistogram(this.histograms.green)
          : null,
        blue: this.histograms.blue
          ? smoothHistogram(this.histograms.blue)
          : null,
        luminance: this.histograms.luminance
          ? smoothHistogram(this.histograms.luminance)
          : null,
      };
      this._smoothDirty = false;
    }
  }

  draw(ctx) {
    this.maybeRebuildSmoothing();

    const widthNow = this.node.size[0];
    if (widthNow !== this._lastLayoutWidth) {
      this.rebuildButtons();
      this._lastLayoutWidth = widthNow;
    }

    ctx.save();
    this.layout.width = this.node.size[0] - HISTOGRAM_CONFIG.padding;

    this.drawBackground(ctx);
    if (this.histograms) {
      this.drawHistogram(ctx);
    }

    this.drawAxisLabels(ctx);

    this.drawButtons(ctx);

    if (this.stats) {
      this.drawStats(ctx);
    }

    this.drawPreviewImage(ctx);

    this.drawHoverInfo(ctx);

    this.drawPreviewHoverInfo(ctx);

    ctx.restore();
  }

  drawBackground(ctx) {
    drawHistogramBackground(ctx, this.layout, {
      fillStyle: DRAW_STYLE_HISTOGRAM.fillStyle,
      strokeStyle: DRAW_STYLE_HISTOGRAM.strokeStyle,
      gridLineStyle: DRAW_STYLE_HISTOGRAM.gridLineStyle,
    });
  }

  getSmoothed(histData) {
    if (!this._smoothedHist || !this.config.smooth) return histData;
    if (histData === this.histograms.red) return this._smoothedHist.red;
    if (histData === this.histograms.green) return this._smoothedHist.green;
    if (histData === this.histograms.blue) return this._smoothedHist.blue;
    if (histData === this.histograms.luminance)
      return this._smoothedHist.luminance;
    return histData;
  }

  drawHistogram(ctx) {
    const { x, y, width, height } = this.layout;
    const numBins = 256;
    const binWidth = width / numBins;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    const drawSingleChannel = (histData, color) => {
      let dataToDraw = this.getSmoothed(histData);

      const positiveValues = dataToDraw.filter((v) => v > 0);
      if (positiveValues.length === 0) {
        return;
      }

      let maxVal;
      if (this.config.scale === "logarithmic") {
        maxVal = Math.log1p(Math.max(...positiveValues));
      } else {
        maxVal = Math.max(...positiveValues);
      }

      if (!maxVal || isNaN(maxVal)) {
        return;
      }

      ctx.fillStyle = color;
      for (let i = 0; i < numBins; i++) {
        let value = dataToDraw[i];
        if (value === 0) continue;

        if (this.config.scale === "logarithmic") {
          value = Math.log1p(value);
        }

        const barHeight = (value / maxVal) * height;
        ctx.fillRect(
          x + i * binWidth,
          y + height - barHeight,
          binWidth,
          barHeight
        );
      }
    };

    if (this.config.type === "luminance") {
      drawSingleChannel(this.histograms.luminance, "rgba(255, 255, 255, 0.8)");
    } else {
      if (this.config.visibleChannels.red)
        drawSingleChannel(this.histograms.red, "rgba(255, 0, 0, 0.7)");
      if (this.config.visibleChannels.green)
        drawSingleChannel(this.histograms.green, "rgba(0, 255, 0, 0.7)");
      if (this.config.visibleChannels.blue)
        drawSingleChannel(this.histograms.blue, "rgba(0, 100, 255, 0.7)");
    }
    ctx.restore();
  }

  drawAxisLabels(ctx) {
    const { x, y, width, height } = this.layout;
    ctx.fillStyle = DRAW_STYLE_AXIS_LABELS.color;
    ctx.font = DRAW_STYLE_AXIS_LABELS.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    ["0", "64", "128", "192", "255"].forEach((v, i) => {
      ctx.fillText(v, x + (i * width) / 4, y + height + 4);
    });
  }

  drawButtons(ctx) {
    this.buttons.forEach((btn) => {
      const style = {
        fillStyle: btn.active ? BUTTON_STYLE.active : BUTTON_STYLE.inactive,
        strokeStyle: BUTTON_STYLE.stroke,
      };
      drawBox(
        ctx,
        { x: btn.x, y: btn.y, width: btn.w, height: btn.h },
        style,
        btn.label,
        {
          textAlign: "center",
          offsetX: btn.w / 2,
        }
      );
    });
  }

  drawStats(ctx) {
    if (!this.stats) {
      return;
    }

    const activeType = this.config.type;
    const sources = [];

    if (activeType === "luminance") {
      if (this.stats.luminance) {
        sources.push({ label: "Luminance", data: this.stats.luminance });
      }
    } else {
      if (this.config.visibleChannels.red && this.stats.red) {
        sources.push({ label: "Red", data: this.stats.red });
      }
      if (this.config.visibleChannels.green && this.stats.green) {
        sources.push({ label: "Green", data: this.stats.green });
      }
      if (this.config.visibleChannels.blue && this.stats.blue) {
        sources.push({ label: "Blue", data: this.stats.blue });
      }
    }

    if (sources.length === 0) {
      return;
    }

    const cols = 6;
    const boxW = STATS_CONFIG.boxWidth;
    const boxH = STATS_CONFIG.boxHeight;
    const gapX = STATS_CONFIG.gapX;
    const gapY = STATS_CONFIG.gapY;
    const totalRowW = cols * boxW + (cols - 1) * gapX;
    const nodeW = this.node.size[0];
    const startX = Math.round((nodeW - totalRowW) / 2);
    const magicYoffset = STATS_START_Y_MAGIC;
    let startY = this.layout.y + this.layout.height + magicYoffset;

    sources.forEach((source) => {
      if (!source.data) return;

      ctx.fillStyle = DRAW_STYLE_STATS.titleFontColor;
      ctx.font = DRAW_STYLE_STATS.titleFont;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(source.label, startX, startY - 2);

      const statSource = source.data;
      const statItems = [
        `Min: ${statSource.min}`,
        `Max: ${statSource.max}`,
        `Mean: ${statSource.mean.toFixed(1)}`,
        `Median: ${statSource.median}`,
        `Mode: ${statSource.mode}`,
        `StdDev: ${statSource.stdDev.toFixed(1)}`,
      ];

      statItems.forEach((text, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = startX + col * (boxW + gapX);
        const y = startY + row * (boxH + gapX);
        drawBox(
          ctx,
          { x, y, width: boxW, height: boxH },
          { fillStyle: DRAW_STYLE_STATS.fillStyle },
          text,
          {
            font: DRAW_STYLE_STATS.statFont,
            textAlign: "center",
            offsetX: boxW / 2,
          }
        );
      });

      const rowsDrawn = Math.ceil(statItems.length / cols);
      startY += rowsDrawn * boxH + gapY;
    });
  }

  drawPreviewImage(ctx) {
    const img = this.previewImage;

    const rect = this.getPreviewDrawRect();
    if (!rect) {
      return;
    }

    if (img && img.complete) {
      ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height);
      ctx.strokeStyle = PREVIEW_STYLE.lineColor;
      ctx.lineWidth = PREVIEW_STYLE.lineWidth;
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

      return;
    }

    const fallbackY = rect.y + rect.height / 2;
    const centerX = this.node.size[0] / 2;
    ctx.fillStyle = PREVIEW_STYLE.fallbackColor;
    ctx.font = PREVIEW_STYLE.fallbackFont;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      "Run the graph to generate preview.",
      centerX,
      fallbackY - PREVIEW_STYLE.fallbackOffsetY
    );
    ctx.fillText(
      "Note: requires output connection.",
      centerX,
      fallbackY + PREVIEW_STYLE.fallbackOffsetY
    );
  }

  drawPreviewHoverInfo(ctx) {
    if (this.hoverPixelInfo) {
      const info = this.hoverPixelInfo;
      let infoText = `RGB: ${info.r}, ${info.g}, ${info.b}\n`;
      infoText += `Luma: ${info.luma.toFixed(1)}\n`;
      infoText += `HSL: ${info.h.toFixed(0)}°, ${info.s.toFixed(
        0
      )}%, ${info.l.toFixed(0)}%`;

      const boxWidth = DRAW_STYLE_HOVER.prevBoxWidth;
      const boxHeight = DRAW_STYLE_HOVER.prevBoxHeight;
      let boxX = info.mouseX + DRAW_STYLE_HOVER.mouseOffsetX;
      let boxY = info.mouseY - boxHeight - DRAW_STYLE_HOVER.mouseOffsetY;

      if (boxX + boxWidth > this.node.size[0])
        boxX = info.mouseX - boxWidth - DRAW_STYLE_HOVER.mouseOffsetX;
      if (boxY < 0) boxY = info.mouseY + DRAW_STYLE_HOVER.mouseOffsetY;

      drawBox(
        ctx,
        {
          x: boxX,
          y: boxY,
          width: boxWidth,
          height: boxHeight,
        },
        {
          fillStyle: DRAW_STYLE_HOVER.boxColor,
          strokeStyle: DRAW_STYLE_HOVER.boxStrokeColor,
          lineWidth: DRAW_STYLE_HOVER.boxStrokeWidth,
        }
      );

      drawMultilineText(
        ctx,
        infoText,
        boxX + DRAW_STYLE_HOVER.textPaddingX,
        boxY + DRAW_STYLE_HOVER.textPaddingY,
        {
          fillStyle: DRAW_STYLE_HOVER.fontColor,
          font: DRAW_STYLE_HOVER.font,
          textAlign: "left",
          textBaseline: "top",
        }
      );
    }
  }

  drawHoverInfo(ctx) {
    if (!this.histograms) return;

    const { x, y, width, height } = this.layout;
    const info = this.hoverPixelInfo || this.hoverHistogramBinInfo;
    if (!info) return;

    const labelLines = [];

    function formatBinHoverLine(label, bin, channelRaw, channelSmooth) {
      return (
        `${label} [${bin}]: ${channelRaw}` +
        (channelSmooth !== null ? ` (smooth: ${channelSmooth.toFixed(0)})` : "")
      );
    }

    if (this.config.type === "rgb") {
      const show = this.config.visibleChannels;
      const binR = info.binR ?? info.bin;
      const binG = info.binG ?? info.bin;
      const binB = info.binB ?? info.bin;

      if (show.red) {
        drawBinLine(ctx, binR, x, y, width, height, "red");
        const rRaw = this.histograms.red?.[binR] ?? 0;
        const rSmooth = this.config.smooth ? this._smoothedHist?.red?.[binR] ?? null : null;
        labelLines.push(formatBinHoverLine("Red", binR, rRaw, rSmooth));
      }
      if (show.green) {
        drawBinLine(ctx, binG, x, y, width, height, "green");
        const gRaw = this.histograms.green?.[binG] ?? 0;
		const gSmooth = this.config.smooth ? this._smoothedHist?.green?.[binG] ?? null : null;
        labelLines.push(formatBinHoverLine("Green", binG, gRaw, gSmooth));
      }
      if (show.blue) {
        drawBinLine(ctx, binB, x, y, width, height, "blue");
        const bRaw = this.histograms.blue?.[binB] ?? 0;
        const bSmooth = this.config.smooth ? this._smoothedHist?.blue?.[binB] ?? null : null;
        labelLines.push(formatBinHoverLine("Blue", binB, bRaw, bSmooth));
      }
    } else {
      const binLuma = info.binLuma ?? info.bin;
      drawBinLine(ctx, binLuma, x, y, width, height, "yellow");

      const lRaw = this.histograms.luminance?.[binLuma] ?? 0;
      const lSmooth = this.config.smooth ? this._smoothedHist?.luminance?.[binLuma] ?? null : null;

      labelLines.push(formatBinHoverLine("Luma", binLuma, lRaw, lSmooth));
    }

    const boxWidth = DRAW_STYLE_HOVER.histBoxWidth;
    const boxHeight =
      labelLines.length * DRAW_STYLE_HOVER.lineHeight +
      DRAW_STYLE_HOVER.boxMargin;
    let boxX, boxY;

    if (this.hoverHistogramBinInfo) {
      boxX = info.mouseX + DRAW_STYLE_HOVER.mouseOffsetX;
      boxY = info.mouseY - boxHeight - DRAW_STYLE_HOVER.mouseOffsetY;
      if (boxX + boxWidth > this.node.size[0])
        boxX = info.mouseX - boxWidth - DRAW_STYLE_HOVER.mouseOffsetX;
      if (boxY < 0) boxY = info.mouseY + DRAW_STYLE_HOVER.mouseOffsetY;
    } else {
      const margin = 6;
      boxX = this.node?.size?.[0] / 2.0 - boxWidth / 2.0;
      boxY = y + height + margin;
    }

    drawBox(
      ctx,
      { x: boxX, y: boxY, width: boxWidth, height: boxHeight },
      {
        fillStyle: DRAW_STYLE_HOVER.boxColor,
        strokeStyle: DRAW_STYLE_HOVER.boxStrokeColor,
        lineWidth: DRAW_STYLE_HOVER.boxStrokeWidth,
      }
    );

    ctx.font = DRAW_STYLE_HOVER.font;
    ctx.fillStyle = DRAW_STYLE_HOVER.fontColor;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    labelLines.forEach((line, i) => {
      ctx.fillText(
        line,
        boxX + DRAW_STYLE_HOVER.textPaddingX,
        boxY + DRAW_STYLE_HOVER.textPaddingY + i * DRAW_STYLE_HOVER.lineHeight
      );
    });
  }

  onMouseDown(e, localPos) {
    const [mx, my] = localPos;
    let handled = false;

    for (const btn of this.buttons) {
      if (
        mx > btn.x &&
        mx < btn.x + btn.w &&
        my > btn.y &&
        my < btn.y + btn.h
      ) {
        this.handleButtonClick(btn.id);
        handled = true;
        break;
      }
    }
    return handled;
  }

  handleButtonClick(id) {
    const newConfig = { ...this.config };

    if (id.startsWith("type_")) {
      newConfig.type = id.split("_")[1] === "lum" ? "luminance" : "rgb";
    } else if (id.startsWith("scale_")) {
      newConfig.scale = id.split("_")[1] === "lin" ? "linear" : "logarithmic";
    } else if (id === "smooth_toggle") {
      newConfig.smooth = !newConfig.smooth;
    } else if (id.startsWith("ch_")) {
      const ch = id.split("_")[1];
      newConfig.visibleChannels[ch] = !newConfig.visibleChannels[ch];
    }

    this.updateConfig(newConfig);
    this.onConfigChange(this.config);
    this.node.setDirtyCanvas(true, true);
  }

  checkHistogramHover(mx, my) {
    const { x, y, width, height } = this.layout;

    if (mx >= x && mx <= x + width && my >= y && my <= y + height) {
      const bin = Math.floor(((mx - x) / width) * 256);
      const clampedBin = Math.min(255, Math.max(0, bin));

      this.hoverHistogramBinInfo = {
        bin: clampedBin,
        mouseX: mx,
        mouseY: my,
      };

      return true;
    }

    this.hoverHistogramBinInfo = null;
    return false;
  }

  checkPreviewHover(mx, my) {
    const rect = this.getPreviewDrawRect();
    if (!rect || !this.previewCanvas || !this.previewImage) return false;

    const { x, y, width, height } = rect;
    if (mx < x || mx > x + width || my < y || my > y + height) return false;

    const relX = (mx - x) / width;
    const relY = (my - y) / height;
    const imgX = Math.floor(relX * this.previewImage.width);
    const imgY = Math.floor(relY * this.previewImage.height);

    try {
      const ctx = this.previewCanvas.getContext("2d");
      if (!ctx) return false;

      const pixelData = ctx.getImageData(imgX, imgY, 1, 1).data;
      const [r, g, b] = pixelData;
      const luma = rgbToLuminance(r, g, b);
      const [h, s, l] = rgbToHsl(r, g, b);

      this.hoverPixelInfo = {
        r,
        g,
        b,
        luma,
        h,
        s,
        l,
        binR: r,
        binG: g,
        binB: b,
        binLuma: Math.floor(luma),
        mouseX: mx,
        mouseY: my,
      };
    } catch (err) {
      console.warn("Pixel sampling error:", err);
      this.hoverPixelInfo = null;
    }

    return true;
  }

  onMouseMove(e, localPos) {
    const [mx, my] = localPos;

    let histogramHover = this.checkHistogramHover(mx, my);
    let previewHover = this.checkPreviewHover(mx, my);

    if (!histogramHover && !previewHover) {
      this.hoverPixelInfo = null;
    }

    const [lastX, lastY] = this.lastMousePos ?? [-1, -1];
    if (mx !== lastX || my !== lastY) {
      this.node.setDirtyCanvas(true, true);
    }

    this.lastMousePos = [mx, my];
  }

  onMouseLeave() {
    this.hoverPixelInfo = null;
    this.lastMousePos = null;
    this.node.setDirtyCanvas(true, true);
  }
}
