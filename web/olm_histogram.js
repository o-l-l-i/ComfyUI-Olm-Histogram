import { app } from "../../scripts/app.js";
import { HistogramWidget } from "./histogram_widget.js";

function removeInputs(node, filter) {
  if (
    !node ||
    node.type !== "OlmHistogram" ||
    node.id === -1 ||
    !Array.isArray(node.inputs)
  ) {
    return;
  }
  for (let i = node.inputs.length - 1; i >= 0; i--) {
    if (filter(node.inputs[i])) {
      try {
        node.removeInput(i);
      } catch (error) {
        console.warn(
          `[OlmHistogram] Node ${node.id}: skipping input removal (graph not ready):`,
          node.inputs[i].name
        );
      }
    }
  }
}

function hideWidget(widget, extraYOffset = -4) {
  if (widget) {
    widget.hidden = true;
    widget.computeSize = () => [0, extraYOffset];
  }
}

app.registerExtension({
  name: "olm.color.histogram",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "OlmHistogram") return;

    nodeType.prototype.getWidget = function (name) {
      return this.widgets.find((w) => w.name === name);
    };

    nodeType.prototype.getWidgetValue = function (name, fallback = null) {
      return this.widgets.find((w) => w.name === name)?.value || fallback;
    };

    nodeType.prototype.setWidgetValue = function (widgetName, val) {
      const widget = this.getWidget(widgetName);
      if (widget && val !== null && val !== undefined) {
        widget.value = val;
      }
    };

    const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      originalOnNodeCreated?.call(this);

      this.properties = this.properties || {};

      const onWidgetConfigChange = (newConfig) => {
        Object.assign(this.properties, newConfig);
      };

      hideWidget(this.getWidget("version"), 0);

      this.widget = new HistogramWidget(this, onWidgetConfigChange);

      this.requestHistogramUpdate = () => {
        if (!this.histogramCacheKey) {
          console.warn("[OlmHistogram] No cache key available yet.");
          return;
        }
        fetch(
          `/olm/api/histogram/generate?key=${encodeURIComponent(
            this.histogramCacheKey
          )}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          }
        )
          .then((res) => res.json())
          .then((data) => {
            if (data.status === "success") {
              this.widget.updateData(data);
            } else {
              console.error("[OlmHistogram] Histogram Error:", data.message);
            }
          })
          .catch((err) => {
            console.error(
              "[OlmHistogram] Failed to fetch histogram data:",
              err
            );
          });
      };
    };

    const originalOnConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      originalOnConfigure?.call(this, info);

      if (this.widget) {
        const config = {
          type: this.properties.type || "luminance",
          scale: this.properties.scale || "linear",
          smooth: this.properties.smooth || false,
          visibleChannels: this.properties.visibleChannels || {
            red: true,
            green: true,
            blue: true,
          },
        };
        this.widget.updateConfig(config);
      }

      removeInputs(this, (input) => input.type === "STRING");

      this.setDirtyCanvas(true, true);
    };

    nodeType.prototype.onAdded = function () {
      patchSingleWidgetMouseEvents(this);

      removeInputs(this, (input) => input.type === "STRING");
    };

    const originalOnExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      originalOnExecuted?.call(this, message);

      let key = message?.cache_key;

      if (Array.isArray(key)) {
        key = key.join("");
      }

      if (typeof key === "string") {
        this.histogramCacheKey = key;
        this.requestHistogramUpdate();
      } else {
        console.warn(
          "[OlmHistogram] Invalid or missing cache key in message:",
          key
        );
      }
    };

    nodeType.prototype.computeSize = function (out) {
      const size = LiteGraph.LGraphNode.prototype.computeSize.call(this, out);

      const minWidth = 340;
      const baseHeight = 370;
      let previewHeight = 240;

      if (this.widget?.previewImage || true) {
        const aspect =
          this.widget?.previewImage?.width /
            this.widget?.previewImage?.height || 1.5;
        previewHeight = Math.min((minWidth * 0.95) / aspect, 260);
      }

      size[0] = Math.max(minWidth, size[0]);
      size[1] = baseHeight + previewHeight;

      return size;
    };

    nodeType.prototype.forceUpdate = function () {
      const version_widget = this.getWidget("version");
      if (version_widget) {
        this.setWidgetValue(version_widget.name, Date.now());
      }
    };

    function patchSingleWidgetMouseEvents(node) {
      const originalOnMouseDown = node.onMouseDown;
      const originalOnMouseMove = node.onMouseMove;
      const originalOnMouseLeave = node.onMouseLeave;

      node.onMouseDown = function (e, pos, canvas) {
        originalOnMouseDown?.call(this, e, pos, canvas);
        return this.widget?.onMouseDown?.(e, pos);
      };

      node.onMouseMove = function (e, pos, canvas) {
        originalOnMouseMove?.call(this, e, pos, canvas);
        return this.widget?.onMouseMove?.(e, pos);
      };

      node.onMouseLeave = function (e, pos, canvas) {
        originalOnMouseLeave?.call(this, e, pos, canvas);
        return this.widget?.onMouseLeave?.(e, pos);
      };
    }

    const originalOnDrawForeground = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      originalOnDrawForeground?.call(this, ctx);
      if (this.flags.collapsed) return;
      this.widget?.draw(ctx);
    };
  },
});
