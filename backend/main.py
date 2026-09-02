from fastapi import FastAPI, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageOps
from dotenv import load_dotenv

import base64
import io
import os
import requests

# ============================================================
# CONFIGURATION
# ============================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_FILE = os.path.join(BASE_DIR, ".env")
load_dotenv(ENV_FILE, override=True)

app = FastAPI(
    title="SatQuery-AI API",
    version="1.3"
)

# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# HUGGING FACE CONFIG
# ============================================================

HF_TOKEN = os.getenv("HF_TOKEN")
HF_MODEL = "zai-org/GLM-4.5V:novita"
HF_URL = "https://router.huggingface.co/v1/chat/completions"

# ============================================================
# ROOT / HEALTH
# ============================================================

@app.get("/")
def root():
    return {
        "status": "online",
        "service": "SatQuery-AI",
        "version": "1.3",
    }


@app.get("/api/health")
def health():
    return {
        "status": "healthy",
        "vqa": "ready" if HF_TOKEN else "demo-mode",
        "model": HF_MODEL,
        "token_loaded": bool(HF_TOKEN),
    }

# ============================================================
# HELPERS
# ============================================================

def extension(name: str) -> str:
    return os.path.splitext(name.lower())[1]


def make_ai_image(image_bytes: bytes, filename: str):
    try:
        source = Image.open(io.BytesIO(image_bytes))
        source.load()
        source = ImageOps.exif_transpose(source)

        try:
            source.seek(0)
        except Exception:
            pass

        max_side = 1600
        source.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)

        if source.mode in ("RGBA", "LA", "P"):
            if source.mode == "P":
                source = source.convert("RGBA")

            background = Image.new("RGB", source.size, "white")
            background.paste(source, mask=source.getchannel("A"))
            source = background
        else:
            source = source.convert("RGB")

        output = io.BytesIO()
        source.save(output, format="JPEG", quality=82, optimize=True)
        jpeg_bytes = output.getvalue()

        encoded = base64.b64encode(jpeg_bytes).decode("utf-8")
        image_data_url = "data:image/jpeg;base64," + encoded

        return image_data_url, source.width, source.height, len(jpeg_bytes)

    except Exception as exc:
        raise ValueError(f"Could not decode satellite image: {exc}") from exc


def category_to_color(category: str):
    return {
        "water": (30, 110, 255),
        "vegetation": (50, 205, 80),
        "built_up": (255, 55, 55),
        "bare_land": (255, 190, 30),
        "agriculture": (40, 210, 190),
        "other": (160, 80, 255),
    }.get(category, (160, 80, 255))


def classify_land_pixel(r, g, b):
    """RGB visual heuristic for demo satellite change classification."""
    brightness = (r + g + b) / 3
    max_channel = max(r, g, b)
    min_channel = min(r, g, b)

    # Water - blue dominant
    if b > r * 1.18 and b > g * 1.08 and b > 55:
        return "water"

    # Vegetation - green dominant
    if g > r * 1.12 and g > b * 1.08 and g > 45:
        return "vegetation"

    # Built-up - bright neutral / low saturation
    if brightness > 75 and (max_channel - min_channel) < 35:
        return "built_up"

    # Bare land - brown/yellow
    if r > 75 and g > 55 and r > b * 1.20 and g > b * 1.10:
        return "bare_land"

    # Agriculture - cyan-ish / mixed green
    if g > 70 and b > 55 and g > r * 1.05:
        return "agriculture"

    return "other"

# ============================================================
# VQA
# ============================================================

@app.post("/api/vqa")
async def vqa(
    image: UploadFile = File(...),
    question: str = Form(...),
):
    if not question.strip():
        return {"success": False, "error": "Question cannot be empty."}

    allowed = {
        ".png", ".jpg", ".jpeg", ".tif", ".tiff",
        ".jp2", ".j2k", ".nitf"
    }

    filename = image.filename or "satellite"
    ext = extension(filename)

    if ext not in allowed:
        return {
            "success": False,
            "error": (
                "Unsupported image format. Use PNG, JPG/JPEG, "
                "GeoTIFF, JP2/J2K or NITF."
            ),
        }

    image_bytes = await image.read()

    if not image_bytes:
        return {"success": False, "error": "Uploaded image is empty."}

    max_upload_size = 50 * 1024 * 1024
    if len(image_bytes) > max_upload_size:
        return {"success": False, "error": "Maximum image size is 50 MB."}

    try:
        image_data_url, width, height, ai_size = make_ai_image(
            image_bytes, filename
        )
    except ValueError as exc:
        return {"success": False, "error": str(exc)}

    if not HF_TOKEN:
        return {
            "success": True,
            "mode": "demo",
            "provider": "demo",
            "question": question.strip(),
            "answer": (
                "Demo VQA response. Add HF_TOKEN in backend/.env "
                "to enable live satellite-image question answering."
            ),
            "image_width": width,
            "image_height": height,
        }

    payload = {
        "model": HF_MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            "You are SatQuery AI, a satellite imagery analysis assistant.\n\n"
                            "Analyze ONLY the provided satellite image.\n\n"
                            "Answer the user's question using only information that is actually visible in the image.\n\n"
                            "Do not invent objects, locations, buildings, roads, water bodies or other details.\n\n"
                            "If something cannot be determined from the image, clearly say so.\n\n"
                            "Give a concise and factual answer.\n\n"
                            f"User question: {question.strip()}"
                        ),
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": image_data_url},
                    },
                ],
            }
        ],
        "max_tokens": 600,
    }

    headers = {
        "Authorization": f"Bearer {HF_TOKEN}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    try:
        response = requests.post(
            HF_URL,
            headers=headers,
            json=payload,
            timeout=120,
        )

        print("HUGGING FACE VQA STATUS:", response.status_code)
        print("HUGGING FACE VQA RESPONSE:", response.text[:2000])

        if response.status_code != 200:
            try:
                error_data = response.json()
            except Exception:
                error_data = response.text
            return {
                "success": False,
                "error": f"AI API error: {response.status_code}",
                "details": error_data,
            }

        try:
            data = response.json()
        except ValueError:
            return {
                "success": False,
                "error": "AI returned invalid JSON.",
                "details": response.text[:2000],
            }

        if "choices" not in data or not data["choices"]:
            return {
                "success": False,
                "error": "AI returned an unexpected response.",
                "details": data,
            }

        message = data["choices"][0].get("message", {})
        answer = message.get("content") or message.get("reasoning_content") or ""

        if not answer:
            return {
                "success": False,
                "error": "AI response did not contain an answer.",
                "details": data,
            }

        return {
            "success": True,
            "mode": "live",
            "provider": "huggingface",
            "model": HF_MODEL,
            "question": question.strip(),
            "answer": answer,
            "image_width": width,
            "image_height": height,
            "ai_payload_kb": round(ai_size / 1024, 1),
        }

    except requests.RequestException as exc:
        return {
            "success": False,
            "error": "Unable to connect to AI service.",
            "details": str(exc),
        }
    except Exception as exc:
        return {
            "success": False,
            "error": "Unexpected AI error.",
            "details": str(exc),
        }

# ============================================================
# CHANGE DETECTION
# ============================================================

@app.post("/api/change-detection")
async def change_detection(
    before_image: UploadFile = File(...),
    after_image: UploadFile = File(...),
    before_date: str = Form(""),
    after_date: str = Form(""),
):
    try:
        before_bytes = await before_image.read()
        after_bytes = await after_image.read()

        if not before_bytes or not after_bytes:
            return {
                "success": False,
                "error": "Both before and after images are required.",
            }

        before = Image.open(io.BytesIO(before_bytes))
        after = Image.open(io.BytesIO(after_bytes))

        before = ImageOps.exif_transpose(before).convert("RGB")
        after = ImageOps.exif_transpose(after).convert("RGB")

        width = 900
        height = round(width * (after.height / after.width))

        before = before.resize((width, height), Image.Resampling.LANCZOS)
        after = after.resize((width, height), Image.Resampling.LANCZOS)

        before_pixels = before.load()
        after_pixels = after.load()

        change_map = Image.new("RGB", (width, height), (35, 35, 35))
        output_pixels = change_map.load()

        threshold = 45
        changed_pixels = 0

        categories = {
            "water": 0,
            "vegetation": 0,
            "built_up": 0,
            "bare_land": 0,
            "agriculture": 0,
            "other": 0,
        }

        for y in range(height):
            for x in range(width):
                r1, g1, b1 = before_pixels[x, y]
                r2, g2, b2 = after_pixels[x, y]

                difference = (
                    abs(r1 - r2)
                    + abs(g1 - g2)
                    + abs(b1 - b2)
                )

                if difference > threshold * 3:
                    changed_pixels += 1
                    category = classify_land_pixel(r2, g2, b2)
                    categories[category] += 1
                    output_pixels[x, y] = category_to_color(category)
                else:
                    gray = int(((r2 + g2 + b2) / 3) * 0.22)
                    output_pixels[x, y] = (gray, gray, gray)

        total_pixels = width * height
        overall_change = (changed_pixels / total_pixels) * 100

        category_percentages = {
            category: round((count / total_pixels) * 100, 2)
            for category, count in categories.items()
        }

        output = io.BytesIO()
        change_map.save(output, format="PNG", optimize=True)
        encoded = base64.b64encode(output.getvalue()).decode("utf-8")
        image_data_url = "data:image/png;base64," + encoded

        return {
            "success": True,
            "mode": "visual-classification",
            "before_date": before_date,
            "after_date": after_date,
            "width": width,
            "height": height,
            "overall_change": round(overall_change, 2),
            "categories": category_percentages,
            "category_pixels": categories,
            "change_map": image_data_url,
        }

    except Exception as exc:
        print("CHANGE DETECTION ERROR:", str(exc))
        return {
            "success": False,
            "error": "Unable to process change detection.",
            "details": str(exc),
        }

# ============================================================
# AI CHANGE INTERPRETATION
# ============================================================

@app.post("/api/change-interpretation")
async def change_interpretation(
    before_image: UploadFile = File(...),
    after_image: UploadFile = File(...),
    overall_change: str = Form(""),
    categories: str = Form(""),
    before_date: str = Form(""),
    after_date: str = Form(""),
):
    try:
        before_bytes = await before_image.read()
        after_bytes = await after_image.read()

        if not before_bytes or not after_bytes:
            return {
                "success": False,
                "error": "Both before and after images are required.",
            }

        before_url, _, _, _ = make_ai_image(
            before_bytes,
            before_image.filename or "before.jpg",
        )
        after_url, _, _, _ = make_ai_image(
            after_bytes,
            after_image.filename or "after.jpg",
        )

        category_text = categories or "{}"

        prompt = f"""
You are SatQuery AI, an expert assistant for satellite change detection.

Compare the BEFORE and AFTER satellite images carefully.

Use ONLY visible evidence from the two images.
Do not invent exact objects, locations, causes, coordinates, or measurements
that cannot be determined from the images.

Observation period:
Before date: {before_date or 'Not provided'}
After date: {after_date or 'Not provided'}

Detected visual change: {overall_change or 'Not provided'}%

Detected category statistics:
{category_text}

Provide a concise interpretation with these points:
1. Major visible changes.
2. Land-cover categories that changed.
3. Vegetation change.
4. Built-up/urban change.
5. Water-body change.
6. Other visible land-use changes.

Important:
- Distinguish visible evidence from uncertainty.
- Do not claim exact numerical changes unless provided above.
- Keep the answer concise and factual.
"""

        if not HF_TOKEN:
            return {
                "success": True,
                "mode": "demo",
                "provider": "demo",
                "interpretation": (
                    "AI change interpretation is in demo mode. "
                    "Add HF_TOKEN to enable live analysis."
                ),
            }

        payload = {
            "model": HF_MODEL,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": before_url},
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": after_url},
                        },
                    ],
                }
            ],
            "max_tokens": 700,
        }

        headers = {
            "Authorization": f"Bearer {HF_TOKEN}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        response = requests.post(
            HF_URL,
            headers=headers,
            json=payload,
            timeout=180,
        )

        print("AI CHANGE STATUS:", response.status_code)
        print("AI CHANGE RESPONSE:", response.text[:3000])

        if response.status_code != 200:
            try:
                error_data = response.json()
            except Exception:
                error_data = response.text
            return {
                "success": False,
                "error": f"AI API error: {response.status_code}",
                "details": error_data,
            }

        try:
            data = response.json()
        except ValueError:
            return {
                "success": False,
                "error": "AI returned invalid JSON.",
                "details": response.text[:2000],
            }

        if "choices" not in data or not data["choices"]:
            return {
                "success": False,
                "error": "AI returned an unexpected response.",
                "details": data,
            }

        message = data["choices"][0].get("message", {})
        interpretation = (
            message.get("content")
            or message.get("reasoning_content")
            or ""
        )

        if not interpretation:
            return {
                "success": False,
                "error": "AI response did not contain an interpretation.",
                "details": data,
            }

        return {
            "success": True,
            "mode": "live",
            "provider": "huggingface",
            "model": HF_MODEL,
            "before_date": before_date,
            "after_date": after_date,
            "overall_change": overall_change,
            "categories": category_text,
            "interpretation": interpretation,
        }

    except requests.RequestException as exc:
        print("AI CHANGE REQUEST ERROR:", str(exc))
        return {
            "success": False,
            "error": "Unable to connect to AI service.",
            "details": str(exc),
        }
    except Exception as exc:
        print("AI CHANGE UNEXPECTED ERROR:", str(exc))
        return {
            "success": False,
            "error": "Unexpected AI interpretation error.",
            "details": str(exc),
        }

# ============================================================
# RUN SERVER
# ============================================================

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
    )
