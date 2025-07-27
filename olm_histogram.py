import torch
from aiohttp import web
from server import PromptServer
import numpy as np
from PIL import Image
import base64
from io import BytesIO
from collections import OrderedDict
import json


DEBUG_MODE = False
PREVIEW_RESOLUTION = 512


preview_cache = OrderedDict()
MAX_CACHE_ITEMS = 10


def debug_print(*args, **kwargs):
    if DEBUG_MODE:
        print(*args, **kwargs)


def prune_node_cache(workflow_id, node_id):
    debug_print(
        "[OlmHistogram] pruning cache, removing cached data for workflow:",
        workflow_id,
        ", node id:",
        node_id,
    )
    prefix = f"histogram_{workflow_id}_{node_id}"
    for key in list(preview_cache.keys()):
        if key.startswith(prefix):
            del preview_cache[key]


def get_preview_image(key):
    img_tensor = preview_cache.get(key)
    if img_tensor is None:
        return None
    if img_tensor.dim() == 3:
        img_tensor = img_tensor.unsqueeze(0)
    return img_tensor


def pil_to_base64(pil_img, format="PNG"):
    buffered = BytesIO()
    pil_img.save(buffered, format=format)
    return base64.b64encode(buffered.getvalue()).decode("utf-8")


def tensor_to_pil(tensor):
    if tensor.dim() == 4:
        tensor = tensor.squeeze(0)

    tensor = torch.clamp(tensor, 0, 1)

    if tensor.shape[0] <= 4:
        tensor = tensor.permute(1, 2, 0)

    array = (tensor.cpu().numpy() * 255).astype(np.uint8)
    return Image.fromarray(array)


def compute_histogram_stats(image_tensor: torch.Tensor):

    if image_tensor.dim() == 4:
        image_tensor = image_tensor.squeeze(0)

    img_np = (torch.clamp(image_tensor, 0, 1).cpu().numpy() * 255).astype(np.uint8)

    if img_np.shape[-1] == 4:
        img_np = img_np[..., :3]

    r = img_np[..., 0]
    g = img_np[..., 1]
    b = img_np[..., 2]

    lum = (0.299 * r + 0.587 * g + 0.114 * b).astype(np.uint8)

    def get_stats(data):
        hist, _ = np.histogram(data, bins=256, range=(0, 256))
        return {
            "min": int(np.min(data)),
            "max": int(np.max(data)),
            "mean": float(np.mean(data)),
            "median": int(np.median(data)),
            "stdDev": float(np.std(data)),
            "mode": int(np.argmax(hist)),
            "dynamicRange": int(np.max(data) - np.min(data)),
        }

    return {
        "histograms": {
            "luminance": np.histogram(lum, bins=256, range=(0, 256))[0].tolist(),
            "red": np.histogram(r, bins=256, range=(0, 256))[0].tolist(),
            "green": np.histogram(g, bins=256, range=(0, 256))[0].tolist(),
            "blue": np.histogram(b, bins=256, range=(0, 256))[0].tolist(),
        },
        "stats": {
            "luminance": get_stats(lum),
            "red": get_stats(r),
            "green": get_stats(g),
            "blue": get_stats(b),
        },
    }


class OlmHistogram:

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "version": ("STRING", {"default": "init"}),
                "image": ("IMAGE",),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
                "node_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("Histogram Data (JSON)",)
    FUNCTION = "execute"
    CATEGORY = "image/analysis"
    OUTPUT_NODE = True

    def execute(
        self,
        version,
        image: torch.Tensor,
        prompt=None,
        extra_pnginfo=None,
        node_id=None,
    ):

        if image.dim() == 4 and image.shape[0] > 1:
            raise ValueError("[OlmHistogram] Batched image input is not supported.")

        workflow_id = None
        if extra_pnginfo and "workflow" in extra_pnginfo:
            workflow_id = extra_pnginfo["workflow"].get("id", "unknown")
        if node_id is None:
            node_id = "x"
        cache_key = f"histogram_{workflow_id}_{node_id}"
        debug_print("[OlmHistogram] cache key:", cache_key)

        prune_node_cache(workflow_id, node_id)
        preview_cache[cache_key] = image.clone().detach()
        preview_cache.move_to_end(cache_key)

        debug_print("[OlmHistogram] Cached items count:", len(preview_cache))
        debug_print("[OlmHistogram] Current cache keys:", list(preview_cache.keys()))

        if len(preview_cache) > MAX_CACHE_ITEMS:
            oldest_key, _ = preview_cache.popitem(last=False)
            debug_print(f"[OlmHistogram] Pruned oldest cache entry: {oldest_key}")

        histogram_data = compute_histogram_stats(image)

        stats_str = json.dumps(histogram_data["stats"], indent=2)
        debug_print("[OlmHistogram] histogram_data:", histogram_data["stats"])

        return {
            "ui": {
                "cache_key": cache_key,
                "message": "Histogram generated",
            },
            "result": (stats_str,) if stats_str else ("",),
        }


@PromptServer.instance.routes.post("/olm/api/histogram/generate")
async def generate_histogram_data(request):
    try:
        key = request.query.get("key", None)
        if key is None:
            return web.json_response(
                {"status": "error", "message": "Missing histogram cache key."},
                status=400,
            )

        debug_print(f"[OlmHistogram] Fetching image with key: {key}")
        source_image = get_preview_image(key)
        if source_image is None:
            return web.json_response(
                {
                    "status": "error",
                    "message": "No source image found. Please run the graph.",
                },
                status=404,
            )

        debug_print("[OlmHistogram] Computing histogram stats...")
        result = compute_histogram_stats(source_image)

        debug_print("[OlmHistogram] Converting to PIL for preview...")
        preview_img = tensor_to_pil(source_image)
        preview_img.thumbnail((PREVIEW_RESOLUTION, PREVIEW_RESOLUTION))

        debug_print("[OlmHistogram] Returning JSON response")
        return web.json_response(
            {
                "status": "success",
                "preview_image": f"data:image/png;base64,{pil_to_base64(preview_img)}",
                "histograms": result["histograms"],
                "stats": result["stats"],
            }
        )

    except Exception as e:
        import traceback

        traceback.print_exc()
        return web.json_response({"status": "error", "message": str(e)}, status=500)


NODE_CLASS_MAPPINGS = {"OlmHistogram": OlmHistogram}


NODE_DISPLAY_NAME_MAPPINGS = {"OlmHistogram": "Olm Histogram"}


WEB_DIRECTORY = "./web"
