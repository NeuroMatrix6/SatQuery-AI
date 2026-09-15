from fastapi import FastAPI, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageOps
from dotenv import load_dotenv

import base64
import io
import json
import os
import requests
import time

import cv2
import numpy as np


# ============================================================
# CONFIGURATION
# ============================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_FILE = os.path.join(BASE_DIR, ".env")

load_dotenv(
    ENV_FILE,
    override=True
)


app = FastAPI(
    title="SatQuery-AI API",
    version="1.4"
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

HF_URL = (
    "https://router.huggingface.co/"
    "v1/chat/completions"
)

# ============================================================
# COPERNICUS DATA SPACE CONFIG
# ============================================================

CDSE_CLIENT_ID = os.getenv("CDSE_CLIENT_ID")
CDSE_CLIENT_SECRET = os.getenv("CDSE_CLIENT_SECRET")

CDSE_TOKEN_URL = (
    "https://identity.dataspace.copernicus.eu/"
    "auth/realms/CDSE/protocol/openid-connect/token"
)

CDSE_CATALOG_URL = (
    "https://sh.dataspace.copernicus.eu/"
    "catalog/v1/search"
)

CDSE_PROCESS_URL = (
    "https://sh.dataspace.copernicus.eu/"
    "process/v1"
)

# Cache the OAuth token so we do not request a new token
# for every Catalog API call.
CDSE_ACCESS_TOKEN = None
CDSE_TOKEN_EXPIRES_AT = 0


# ============================================================
# COPERNICUS HELPERS
# ============================================================

def get_cdse_access_token():
    """
    Get a temporary OAuth access token from
    Copernicus Data Space.

    The token is cached and reused until it is
    close to expiry.
    """

    global CDSE_ACCESS_TOKEN
    global CDSE_TOKEN_EXPIRES_AT

    if not CDSE_CLIENT_ID:
        raise RuntimeError(
            "CDSE_CLIENT_ID is missing."
        )

    if not CDSE_CLIENT_SECRET:
        raise RuntimeError(
            "CDSE_CLIENT_SECRET is missing."
        )

    # Reuse cached token while it has at least
    # 60 seconds remaining.
    if (
        CDSE_ACCESS_TOKEN
        and time.time()
        < CDSE_TOKEN_EXPIRES_AT - 60
    ):
        return CDSE_ACCESS_TOKEN

    payload = {
        "grant_type": "client_credentials",
        "client_id": CDSE_CLIENT_ID,
        "client_secret": CDSE_CLIENT_SECRET,
    }

    headers = {
        "Content-Type":
            "application/x-www-form-urlencoded",
        "Accept":
            "application/json",
    }

    response = requests.post(
        CDSE_TOKEN_URL,
        data=payload,
        headers=headers,
        timeout=30,
    )

    if response.status_code != 200:

        try:
            details = response.json()
        except Exception:
            details = response.text[:1500]

        raise RuntimeError(
            "CDSE authentication failed: "
            f"{response.status_code} - {details}"
        )

    data = response.json()

    access_token = data.get(
        "access_token"
    )

    expires_in = data.get(
        "expires_in",
        300
    )

    if not access_token:
        raise RuntimeError(
            "CDSE authentication succeeded but "
            "no access token was returned."
        )

    CDSE_ACCESS_TOKEN = access_token

    CDSE_TOKEN_EXPIRES_AT = (
        time.time()
        + float(expires_in)
    )

    return CDSE_ACCESS_TOKEN


def format_satellite_scene(item):
    """
    Convert a raw Catalog API item into a
    frontend-friendly Sentinel-2 scene object.
    """

    properties = (
        item.get("properties")
        or {}
    )

    assets = (
        item.get("assets")
        or {}
    )

    acquisition_date = (
        properties.get("datetime")
        or properties.get(
            "start_datetime"
        )
        or properties.get(
            "end_datetime"
        )
    )

    cloud_cover = properties.get(
        "eo:cloud_cover"
    )

    if cloud_cover is None:
        cloud_cover = properties.get(
            "cloud_cover"
        )

    scene_id = (
        item.get("id")
        or "unknown-scene"
    )

    product_name = (
        properties.get("title")
        or properties.get(
            "productName"
        )
        or scene_id
    )

    return {
        "id": scene_id,

        "product_name": product_name,

        "acquisition_date":
            acquisition_date,

        "cloud_cover":
            cloud_cover,

        "collection":
            item.get("collection")
            or "sentinel-2-l2a",

        "bbox":
            item.get("bbox"),

        "geometry":
            item.get("geometry"),

        "assets":
            assets,

        "platform":
            properties.get(
                "platform"
            ),

        "constellation":
            properties.get(
                "constellation"
            ),

        "processing_level":
            properties.get(
                "processing:level"
            ),

        "mgrs_tile":
            properties.get(
                "s2:mgrs_tile"
            ),

        "relative_orbit":
            properties.get(
                "sat:relative_orbit"
            ),

        "orbit_state":
            properties.get(
                "sat:orbit_state"
            ),
    }


# ============================================================
# SENTINEL-2 CATALOG SEARCH
# ============================================================

@app.post("/api/satellite-search")
async def satellite_search(

    west: float = Form(...),

    south: float = Form(...),

    east: float = Form(...),

    north: float = Form(...),

    from_date: str = Form(...),

    to_date: str = Form(...),

    max_cloud_cover: float = Form(100),
):

    global CDSE_ACCESS_TOKEN
    global CDSE_TOKEN_EXPIRES_AT

    # --------------------------------------------------------
    # NORMALIZE INPUT
    # --------------------------------------------------------

    from_date = (
        from_date or ""
    ).strip()

    to_date = (
        to_date or ""
    ).strip()

    # --------------------------------------------------------
    # VALIDATE COORDINATES
    # --------------------------------------------------------

    try:

        west = float(west)
        south = float(south)
        east = float(east)
        north = float(north)

    except (
        TypeError,
        ValueError
    ):

        return {
            "success": False,
            "error":
                "Invalid AOI coordinates."
        }

    if not (
        -180 <= west <= 180
        and -180 <= east <= 180
        and -90 <= south <= 90
        and -90 <= north <= 90
    ):

        return {
            "success": False,
            "error":
                "Coordinates are outside valid WGS84 limits."
        }

    if west >= east:

        return {
            "success": False,
            "error":
                "West must be less than East."
        }

    if south >= north:

        return {
            "success": False,
            "error":
                "South must be less than North."
        }

    # --------------------------------------------------------
    # VALIDATE DATES
    # --------------------------------------------------------

    if not from_date:

        return {
            "success": False,
            "error":
                "From date is required."
        }

    if not to_date:

        return {
            "success": False,
            "error":
                "To date is required."
        }

    if from_date > to_date:

        return {
            "success": False,
            "error":
                "From date cannot be later than To date."
        }

    # --------------------------------------------------------
    # VALIDATE CLOUD COVER
    # --------------------------------------------------------

    try:

        max_cloud_cover = float(
            max_cloud_cover
        )

    except (
        TypeError,
        ValueError
    ):

        return {
            "success": False,
            "error":
                "Invalid cloud-cover value."
        }

    if not (
        0 <= max_cloud_cover <= 100
    ):

        return {
            "success": False,
            "error":
                "Cloud cover must be between 0 and 100."
        }

    # --------------------------------------------------------
    # GET CDSE TOKEN
    # --------------------------------------------------------

    try:

        access_token = (
            get_cdse_access_token()
        )

    except Exception as exc:

        print(
            "CDSE AUTH ERROR:",
            str(exc)
        )

        return {
            "success": False,
            "error":
                "Unable to authenticate with Copernicus Data Space.",
            "details":
                str(exc),
        }

    # --------------------------------------------------------
    # DATETIME RANGE
    # --------------------------------------------------------

    datetime_range = (
        f"{from_date}T00:00:00Z/"
        f"{to_date}T23:59:59Z"
    )

    # --------------------------------------------------------
    # CATALOG REQUEST
    # --------------------------------------------------------

    search_payload = {

        "collections": [
            "sentinel-2-l2a"
        ],

        "datetime":
            datetime_range,

        "bbox": [
            west,
            south,
            east,
            north,
        ],

        "limit": 20,
    }

    # Add cloud-cover filtering only when needed.
    # CQL2 text is supported by the Catalog Filter
    # extension.
    if max_cloud_cover < 100:

        search_payload["filter"] = (
            "eo:cloud_cover <= "
            f"{max_cloud_cover}"
        )

    headers = {
    "Authorization": f"Bearer {access_token}",
    "Content-Type": "application/json",
}

    # --------------------------------------------------------
    # CALL CATALOG API
    # --------------------------------------------------------

    try:

        response = requests.post(

            CDSE_CATALOG_URL,

            headers=headers,

            json=search_payload,

            timeout=60,
        )

        print(
            "CDSE CATALOG STATUS:",
            response.status_code
        )

        # ----------------------------------------------------
        # TOKEN REFRESH RETRY
        # ----------------------------------------------------

        if response.status_code == 401:

            CDSE_ACCESS_TOKEN = None

            CDSE_TOKEN_EXPIRES_AT = 0

            access_token = (
                get_cdse_access_token()
            )

            headers["Authorization"] = (
                f"Bearer {access_token}"
            )

            response = requests.post(

                CDSE_CATALOG_URL,

                headers=headers,

                json=search_payload,

                timeout=60,
            )

            print(
                "CDSE CATALOG RETRY STATUS:",
                response.status_code
            )

        # ----------------------------------------------------
        # API ERROR
        # ----------------------------------------------------

        if response.status_code != 200:

            try:
                details = response.json()

            except Exception:
                details = (
                    response.text[:2000]
                )

            return {

                "success": False,

                "error": (
                    "Sentinel-2 Catalog search failed: "
                    f"{response.status_code}"
                ),

                "details":
                    details,
            }

        # ----------------------------------------------------
        # PARSE JSON
        # ----------------------------------------------------

        try:

            data = response.json()

        except ValueError as exc:

            return {

                "success": False,

                "error":
                    "Copernicus returned invalid JSON.",

                "details":
                    str(exc),
            }

    except requests.RequestException as exc:

        print(
            "CDSE REQUEST ERROR:",
            str(exc)
        )

        return {

            "success": False,

            "error":
                "Unable to connect to Copernicus Data Space.",

            "details":
                str(exc),
        }

    # --------------------------------------------------------
    # FORMAT FEATURES
    # --------------------------------------------------------

    features = (
        data.get("features")
        or []
    )

    scenes = []

    for item in features:

        try:

            scene = (
                format_satellite_scene(
                    item
                )
            )

            scenes.append(scene)

        except Exception as exc:

            print(
                "SCENE FORMAT ERROR:",
                str(exc)
            )

    # --------------------------------------------------------
    # SORT NEWEST FIRST
    # --------------------------------------------------------

    scenes.sort(

        key=lambda scene:
            scene.get(
                "acquisition_date"
            )
            or "",

        reverse=True,
    )

    # --------------------------------------------------------
    # RESPONSE
    # --------------------------------------------------------

    return {

        "success":
            True,

        "collection":
            "sentinel-2-l2a",

        "count":
            len(scenes),

        "query": {

            "bbox": [
                west,
                south,
                east,
                north,
            ],

            "from_date":
                from_date,

            "to_date":
                to_date,

            "max_cloud_cover":
                max_cloud_cover,
        },

        "scenes":
            scenes,
    }
# ============================================================
# ROOT
# ============================================================

@app.get("/")
def root():
    return {
        "status": "online",
        "service": "SatQuery-AI",
        "version": "1.4",
    }


# ============================================================
# HEALTH
# ============================================================

@app.get("/api/health")
def health():
    return {
        "status": "healthy",
        "vqa": (
            "ready"
            if HF_TOKEN
            else "demo-mode"
        ),
        "model": HF_MODEL,
        "token_loaded": bool(HF_TOKEN),
    }


# ============================================================
# HELPERS
# ============================================================

def extension(name: str) -> str:
    return os.path.splitext(
        name.lower()
    )[1]


# ============================================================
# INDEX MAP VISUALIZATION
# ============================================================

def create_index_visualization(index_array, valid_mask, index_type):
    """Create smooth, index-specific scientific visualization."""
    values = np.asarray(index_array, dtype=np.float32)
    mask = np.asarray(valid_mask, dtype=bool)
    clipped = np.clip(values, -1.0, 1.0)

    # Smooth display only; raw scientific values remain unchanged.
    display_values = cv2.resize(
        clipped,
        None,
        fx=1.0,
        fy=1.0,
        interpolation=cv2.INTER_LINEAR,
    )
    display_mask = cv2.resize(
        mask.astype(np.uint8),
        (display_values.shape[1], display_values.shape[0]),
        interpolation=cv2.INTER_NEAREST,
    ).astype(bool)

    ramps = {
        "ndvi": [
            (-1.0, (92, 48, 24)),
            (-0.50, (150, 92, 35)),
            (0.00, (205, 180, 65)),
            (0.20, (165, 205, 70)),
            (0.50, (70, 170, 75)),
            (1.00, (15, 105, 45)),
        ],
        "ndwi": [
            (-1.0, (55, 55, 55)),
            (-0.50, (105, 85, 70)),
            (0.00, (190, 195, 175)),
            (0.20, (70, 190, 205)),
            (0.50, (25, 125, 205)),
            (1.00, (5, 55, 145)),
        ],
        "ndbi": [
            (-1.0, (35, 65, 45)),
            (-0.50, (65, 105, 70)),
            (0.00, (190, 185, 145)),
            (0.20, (235, 175, 65)),
            (0.50, (225, 85, 35)),
            (1.00, (155, 25, 25)),
        ],
    }

    stops = ramps.get(index_type, ramps["ndvi"])
    positions = np.array([item[0] for item in stops], dtype=np.float32)
    colors = np.array([item[1] for item in stops], dtype=np.float32)
    flat = display_values.ravel()
    rgb = np.empty((flat.size, 3), dtype=np.float32)

    for channel in range(3):
        rgb[:, channel] = np.interp(
            flat,
            positions,
            colors[:, channel],
        )

    colored = np.clip(
        rgb.reshape(
            display_values.shape[0],
            display_values.shape[1],
            3,
        ),
        0,
        255,
    ).astype(np.uint8)

    colored[~display_mask] = [0, 0, 0]
    return Image.fromarray(colored, mode="RGB")



# ============================================================
# IMAGE -> AI JPEG DATA URL
# ============================================================

def make_ai_image(
    image_bytes: bytes,
    filename: str
):
    try:

        source = Image.open(
            io.BytesIO(image_bytes)
        )

        source.load()

        source = ImageOps.exif_transpose(
            source
        )

        try:
            source.seek(0)
        except Exception:
            pass

        max_side = 1600

        source.thumbnail(
            (
                max_side,
                max_side
            ),
            Image.Resampling.LANCZOS
        )

        # Handle transparency / palette modes
        if source.mode in (
            "RGBA",
            "LA",
            "P"
        ):

            if source.mode == "P":
                source = source.convert(
                    "RGBA"
                )

            background = Image.new(
                "RGB",
                source.size,
                "white"
            )

            background.paste(
                source,
                mask=source.getchannel("A")
            )

            source = background

        else:
            source = source.convert(
                "RGB"
            )

        output = io.BytesIO()

        source.save(
            output,
            format="JPEG",
            quality=82,
            optimize=True
        )

        jpeg_bytes = output.getvalue()

        encoded = base64.b64encode(
            jpeg_bytes
        ).decode("utf-8")

        image_data_url = (
            "data:image/jpeg;base64,"
            + encoded
        )

        return (
            image_data_url,
            source.width,
            source.height,
            len(jpeg_bytes),
        )

    except Exception as exc:

        raise ValueError(
            f"Could not decode satellite image: {exc}"
        ) from exc


# ============================================================
# CHANGE CATEGORY COLORS
# ============================================================

def category_to_color(category: str):

    return {

        "water": (
            30,
            110,
            255
        ),

        "vegetation": (
            50,
            205,
            80
        ),

        "built_up": (
            255,
            55,
            55
        ),

        "bare_land": (
            255,
            190,
            30
        ),

        "agriculture": (
            40,
            210,
            190
        ),

        "other": (
            160,
            80,
            255
        ),

    }.get(
        category,
        (
            160,
            80,
            255
        )
    )


# ============================================================
# LAND COVER RGB HEURISTIC
# ============================================================

def classify_land_pixel(
    r,
    g,
    b
):

    """
    RGB visual heuristic for demo
    satellite change classification.
    """

    brightness = (
        r + g + b
    ) / 3

    max_channel = max(
        r,
        g,
        b
    )

    min_channel = min(
        r,
        g,
        b
    )

    # --------------------------------------------------------
    # Water
    # --------------------------------------------------------

    if (
        b > r * 1.18
        and b > g * 1.08
        and b > 55
    ):
        return "water"


    # --------------------------------------------------------
    # Vegetation
    # --------------------------------------------------------

    if (
        g > r * 1.12
        and g > b * 1.08
        and g > 45
    ):
        return "vegetation"


    # --------------------------------------------------------
    # Built-up
    # --------------------------------------------------------

    if (
        brightness > 75
        and (
            max_channel
            - min_channel
        ) < 35
    ):
        return "built_up"


    # --------------------------------------------------------
    # Bare land
    # --------------------------------------------------------

    if (
        r > 75
        and g > 55
        and r > b * 1.20
        and g > b * 1.10
    ):
        return "bare_land"


    # --------------------------------------------------------
    # Agriculture
    # --------------------------------------------------------

    if (
        g > 70
        and b > 55
        and g > r * 1.05
    ):
        return "agriculture"


    return "other"


# ============================================================
# SAME-AREA VALIDATION
# ============================================================

def validate_same_area_cv(
    before_bytes: bytes,
    after_bytes: bytes
):
    """
    Estimate whether BEFORE and AFTER images
    represent the same geographic scene.

    Method:
    - ORB feature extraction
    - BFMatcher
    - Lowe ratio test
    - Homography + RANSAC
    - Inlier verification

    This is an MVP visual consistency check.
    It is NOT exact GPS/geospatial verification.
    """

    try:

        # ----------------------------------------------------
        # Decode bytes using OpenCV
        # ----------------------------------------------------

        before_array = np.frombuffer(
            before_bytes,
            dtype=np.uint8
        )

        after_array = np.frombuffer(
            after_bytes,
            dtype=np.uint8
        )


        before = cv2.imdecode(
            before_array,
            cv2.IMREAD_GRAYSCALE
        )

        after = cv2.imdecode(
            after_array,
            cv2.IMREAD_GRAYSCALE
        )


        if (
            before is None
            or after is None
        ):

            return {
                "same_area": False,
                "confidence": 0.0,
                "good_matches": 0,
                "inliers": 0,
                "inlier_ratio": 0.0,
                "reason": (
                    "Unable to decode one or "
                    "both images."
                ),
            }


        # ----------------------------------------------------
        # Resize large images
        # ----------------------------------------------------

        max_side = 1400


        def resize_image(img):

            h, w = img.shape[:2]

            largest_side = max(
                h,
                w
            )

            scale = min(
                1.0,
                max_side / largest_side
            )

            if scale < 1.0:

                return cv2.resize(
                    img,
                    (
                        int(w * scale),
                        int(h * scale)
                    ),
                    interpolation=cv2.INTER_AREA
                )

            return img


        before = resize_image(
            before
        )

        after = resize_image(
            after
        )


        # ----------------------------------------------------
        # Reduce compression noise
        # ----------------------------------------------------

        before = cv2.GaussianBlur(
            before,
            (3, 3),
            0
        )

        after = cv2.GaussianBlur(
            after,
            (3, 3),
            0
        )


        # ----------------------------------------------------
        # ORB
        # ----------------------------------------------------

        orb = cv2.ORB_create(
            nfeatures=3000,
            scaleFactor=1.2,
            nlevels=8,
            edgeThreshold=31,
            fastThreshold=12,
        )


        keypoints1, descriptors1 = (
            orb.detectAndCompute(
                before,
                None
            )
        )

        keypoints2, descriptors2 = (
            orb.detectAndCompute(
                after,
                None
            )
        )


        if (
            descriptors1 is None
            or descriptors2 is None
            or len(keypoints1) < 8
            or len(keypoints2) < 8
        ):

            return {
                "same_area": False,
                "confidence": 0.0,
                "good_matches": 0,
                "inliers": 0,
                "inlier_ratio": 0.0,
                "reason": (
                    "Not enough stable visual "
                    "features were found."
                ),
            }


        # ----------------------------------------------------
        # Match ORB descriptors
        # ----------------------------------------------------

        matcher = cv2.BFMatcher(
            cv2.NORM_HAMMING,
            crossCheck=False
        )


        raw_matches = matcher.knnMatch(
            descriptors1,
            descriptors2,
            k=2
        )


        # ----------------------------------------------------
        # Lowe ratio test
        # ----------------------------------------------------

        good_matches = []

        for pair in raw_matches:

            if len(pair) < 2:
                continue

            m, n = pair

            if m.distance < (
                0.72 * n.distance
            ):

                good_matches.append(m)


        good_count = len(
            good_matches
        )


        # ----------------------------------------------------
        # Minimum match requirement
        # ----------------------------------------------------

        if good_count < 12:

            confidence = min(
                good_count / 12.0,
                1.0
            )

            return {
                "same_area": False,
                "confidence": round(
                    confidence,
                    2
                ),
                "good_matches": good_count,
                "inliers": 0,
                "inlier_ratio": 0.0,
                "reason": (
                    "The images do not contain "
                    "enough matching geographic "
                    "features."
                ),
            }


        # ----------------------------------------------------
        # Corresponding points
        # ----------------------------------------------------

        src_points = np.float32([
            keypoints1[
                match.queryIdx
            ].pt

            for match
            in good_matches

        ]).reshape(
            -1,
            1,
            2
        )


        dst_points = np.float32([
            keypoints2[
                match.trainIdx
            ].pt

            for match
            in good_matches

        ]).reshape(
            -1,
            1,
            2
        )


        # ----------------------------------------------------
        # Homography / RANSAC
        # ----------------------------------------------------

        matrix, mask = cv2.findHomography(
            src_points,
            dst_points,
            cv2.RANSAC,
            5.0
        )


        if (
            matrix is None
            or mask is None
        ):

            return {
                "same_area": False,
                "confidence": 0.0,
                "good_matches": good_count,
                "inliers": 0,
                "inlier_ratio": 0.0,
                "reason": (
                    "Matching features did not "
                    "form a consistent geographic "
                    "relationship."
                ),
            }


        inliers = int(
            mask.ravel().sum()
        )


        inlier_ratio = (
            inliers
            / good_count
        )


        # ----------------------------------------------------
        # Decision threshold
        # ----------------------------------------------------

        same_area = (
            good_count >= 18
            and inliers >= 10
            and inlier_ratio >= 0.28
        )


        # ----------------------------------------------------
        # Confidence
        # ----------------------------------------------------

        confidence = min(
            1.0,
            (
                0.45
                * min(
                    good_count / 60.0,
                    1.0
                )
                +
                0.55
                * min(
                    inlier_ratio / 0.65,
                    1.0
                )
            )
        )


        # ----------------------------------------------------
        # Reason
        # ----------------------------------------------------

        if same_area:

            reason = (
                f"Found {good_count} matching "
                f"visual features with "
                f"{inliers} geometrically "
                f"consistent matches."
            )

        else:

            reason = (
                f"Only {good_count} matching "
                f"visual features were found, "
                f"with {inliers} consistent matches."
            )


        return {
            "same_area": same_area,
            "confidence": round(
                confidence,
                2
            ),
            "good_matches": good_count,
            "inliers": inliers,
            "inlier_ratio": round(
                inlier_ratio,
                3
            ),
            "reason": reason,
        }


    except Exception as exc:

        print(
            "CV SAME-AREA VALIDATION ERROR:",
            str(exc)
        )

        return {
            "same_area": False,
            "confidence": 0.0,
            "good_matches": 0,
            "inliers": 0,
            "inlier_ratio": 0.0,
            "reason": (
                "Could not verify that the "
                "images represent the same area."
            ),
        }

# ============================================================
# SENTINEL-2 IMAGE PREVIEW
# ============================================================

@app.post("/api/satellite-preview")
async def satellite_preview(
    west: float = Form(...),
    south: float = Form(...),
    east: float = Form(...),
    north: float = Form(...),
    acquisition_date: str = Form(...),
):
    """
    Generate a true-color Sentinel-2 L2A image
    for the selected AOI and acquisition date.
    """

    global CDSE_ACCESS_TOKEN
    global CDSE_TOKEN_EXPIRES_AT

    # --------------------------------------------------------
    # VALIDATE COORDINATES
    # --------------------------------------------------------

    try:
        west = float(west)
        south = float(south)
        east = float(east)
        north = float(north)

    except (TypeError, ValueError):
        return {
            "success": False,
            "error": "Invalid AOI coordinates.",
        }

    if not (
        -180 <= west <= 180
        and -180 <= east <= 180
        and -90 <= south <= 90
        and -90 <= north <= 90
    ):
        return {
            "success": False,
            "error": (
                "Coordinates are outside valid WGS84 limits."
            ),
        }

    if west >= east:
        return {
            "success": False,
            "error": "West must be less than East.",
        }

    if south >= north:
        return {
            "success": False,
            "error": "South must be less than North.",
        }

    # --------------------------------------------------------
    # ACQUISITION DATE
    # --------------------------------------------------------

    acquisition_date = (
        acquisition_date or ""
    ).strip()

    if not acquisition_date:
        return {
            "success": False,
            "error": "Acquisition date is required.",
        }

    date_only = acquisition_date[:10]

    from datetime import datetime

    try:
        datetime.strptime(
            date_only,
            "%Y-%m-%d",
        )
    except ValueError:
        return {
            "success": False,
            "error": (
                "Invalid acquisition date. "
                "Expected YYYY-MM-DD."
            ),
        }

    # --------------------------------------------------------
    # AUTHENTICATION
    # --------------------------------------------------------

    try:
        access_token = (
            get_cdse_access_token()
        )

    except Exception as exc:
        print(
            "CDSE PREVIEW AUTH ERROR:",
            str(exc),
        )

        return {
            "success": False,
            "error": (
                "Unable to authenticate with "
                "Copernicus Data Space."
            ),
            "details": str(exc),
        }

    # --------------------------------------------------------
    # TRUE COLOR RGB
    # B04 = RED
    # B03 = GREEN
    # B02 = BLUE
    # --------------------------------------------------------

    evalscript = """
//VERSION=3

function setup() {
  return {
    input: ["B02", "B03", "B04"],
    output: {
      bands: 3,
      sampleType: "AUTO"
    }
  };
}

function evaluatePixel(sample) {
  return [
    2.5 * sample.B04,
    2.5 * sample.B03,
    2.5 * sample.B02
  ];
}
"""

    # --------------------------------------------------------
    # PROCESS REQUEST
    # --------------------------------------------------------

    request_body = {
        "input": {
            "bounds": {
                "bbox": [
                    west,
                    south,
                    east,
                    north,
                ],
                "properties": {
                    "crs":
                        "http://www.opengis.net/def/crs/OGC/1.3/CRS84"
                },
            },

            "data": [
                {
                    "type":
                        "sentinel-2-l2a",

                    "dataFilter": {
                        "timeRange": {
                            "from":
                                f"{date_only}T00:00:00Z",

                            "to":
                                f"{date_only}T23:59:59Z",
                        },

                        "mosaickingOrder":
                            "leastCC",
                    },
                }
            ],
        },

        "output": {
            "width": 768,
            "height": 768,
            "responses": [
                {
                    "identifier": "default",
                    "format": {
                        "type": "image/jpeg",
                    },
                }
            ],
        },

        "evalscript":
            evalscript,
    }

    headers = {
        "Authorization":
            f"Bearer {access_token}",
        "Content-Type":
            "application/json",
    }

    # --------------------------------------------------------
    # CALL PROCESS API
    # --------------------------------------------------------

    try:

        response = requests.post(
            CDSE_PROCESS_URL,
            headers=headers,
            json=request_body,
            timeout=120,
        )

        print(
            "CDSE PREVIEW STATUS:",
            response.status_code,
        )

        # ----------------------------------------------------
        # TOKEN EXPIRED -> REFRESH
        # ----------------------------------------------------

        if response.status_code == 401:

            CDSE_ACCESS_TOKEN = None
            CDSE_TOKEN_EXPIRES_AT = 0

            access_token = (
                get_cdse_access_token()
            )

            headers["Authorization"] = (
                f"Bearer {access_token}"
            )

            response = requests.post(
                CDSE_PROCESS_URL,
                headers=headers,
                json=request_body,
                timeout=120,
            )

            print(
                "CDSE PREVIEW RETRY STATUS:",
                response.status_code,
            )

        # ----------------------------------------------------
        # ERROR
        # ----------------------------------------------------

        if response.status_code != 200:

            try:
                details = response.json()

            except Exception:
                details = (
                    response.text[:3000]
                )

            return {
                "success": False,
                "error": (
                    "Sentinel-2 preview request failed: "
                    f"{response.status_code}"
                ),
                "details": details,
            }

        # ----------------------------------------------------
        # IMAGE
        # ----------------------------------------------------

        image_bytes = response.content

        if not image_bytes:
            return {
                "success": False,
                "error":
                    "Copernicus returned an empty image.",
            }

        encoded = base64.b64encode(
            image_bytes
        ).decode("utf-8")

        image_data_url = (
            "data:image/jpeg;base64,"
            + encoded
        )

        # ----------------------------------------------------
        # SUCCESS
        # ----------------------------------------------------

        return {
            "success": True,

            "date":
                date_only,

            "image":
                image_data_url,

            "format":
                "image/jpeg",

            "width":
                768,

            "height":
                768,

            "bands": [
                "B04",
                "B03",
                "B02",
            ],

            "product":
                "Sentinel-2 L2A",
        }

    except requests.RequestException as exc:

        print(
            "CDSE PREVIEW REQUEST ERROR:",
            str(exc),
        )

        return {
            "success": False,
            "error": (
                "Unable to connect to the "
                "Sentinel-2 Process API."
            ),
            "details": str(exc),
        }

    except Exception as exc:

        print(
            "CDSE PREVIEW UNEXPECTED ERROR:",
            str(exc),
        )

        return {
            "success": False,
            "error":
                "Unexpected Sentinel-2 preview error.",
            "details":
                str(exc),
        }
        # ============================================================
# SENTINEL-2 NDVI ANALYSIS
# ============================================================

@app.post("/api/satellite-ndvi")
async def satellite_ndvi(
    west: float = Form(...),
    south: float = Form(...),
    east: float = Form(...),
    north: float = Form(...),
    acquisition_date: str = Form(...),
):
    """
    Calculate NDVI from Sentinel-2 L2A.

    B04 = Red
    B08 = Near Infrared (NIR)

    NDVI = (NIR - Red) / (NIR + Red)
    """

    global CDSE_ACCESS_TOKEN
    global CDSE_TOKEN_EXPIRES_AT

    # --------------------------------------------------------
    # VALIDATE COORDINATES
    # --------------------------------------------------------

    try:
        west = float(west)
        south = float(south)
        east = float(east)
        north = float(north)

    except (TypeError, ValueError):
        return {
            "success": False,
            "error": "Invalid AOI coordinates.",
        }

    if not (
        -180 <= west <= 180
        and -180 <= east <= 180
        and -90 <= south <= 90
        and -90 <= north <= 90
    ):
        return {
            "success": False,
            "error": (
                "Coordinates are outside valid WGS84 limits."
            ),
        }

    if west >= east:
        return {
            "success": False,
            "error": "West must be less than East.",
        }

    if south >= north:
        return {
            "success": False,
            "error": "South must be less than North.",
        }

    # --------------------------------------------------------
    # VALIDATE DATE
    # --------------------------------------------------------

    acquisition_date = (
        acquisition_date or ""
    ).strip()

    if not acquisition_date:
        return {
            "success": False,
            "error": "Acquisition date is required.",
        }

    date_only = acquisition_date[:10]

    from datetime import datetime

    try:
        datetime.strptime(
            date_only,
            "%Y-%m-%d",
        )

    except ValueError:
        return {
            "success": False,
            "error": (
                "Invalid acquisition date. "
                "Expected YYYY-MM-DD."
            ),
        }

    # --------------------------------------------------------
    # AUTHENTICATION
    # --------------------------------------------------------

    try:
        access_token = get_cdse_access_token()

    except Exception as exc:
        print(
            "CDSE NDVI AUTH ERROR:",
            str(exc),
        )

        return {
            "success": False,
            "error": (
                "Unable to authenticate with "
                "Copernicus Data Space."
            ),
            "details": str(exc),
        }

    # --------------------------------------------------------
    # NDVI EVALSCRIPT
    #
    # B04 = Red
    # B08 = NIR
    #
    # SCL is used to ignore:
    # 3  = cloud shadow
    # 8  = cloud medium probability
    # 9  = cloud high probability
    # 10 = cirrus
    # 11 = snow / ice
    # --------------------------------------------------------

    evalscript = """
//VERSION=3

function setup() {
  return {
    input: [
      "B04",
      "B08",
      "SCL"
    ],
    output: {
      bands: 1,
      sampleType: "FLOAT32"
    }
  };
}

function evaluatePixel(sample) {

  // Mask clouds, cloud shadows, cirrus and snow
  if (
    sample.SCL === 3 ||
    sample.SCL === 8 ||
    sample.SCL === 9 ||
    sample.SCL === 10 ||
    sample.SCL === 11
  ) {
    return [-9999];
  }

  var red = sample.B04;
  var nir = sample.B08;

  var denominator = nir + red;

  if (denominator === 0) {
    return [-9999];
  }

  var ndvi = (nir - red) / denominator;

  return [ndvi];
}
"""

    # --------------------------------------------------------
    # COPERNICUS PROCESS REQUEST
    # --------------------------------------------------------

    request_body = {
        "input": {

            "bounds": {
                "bbox": [
                    west,
                    south,
                    east,
                    north,
                ],
                "properties": {
                    "crs":
                        "http://www.opengis.net/def/crs/OGC/1.3/CRS84"
                },
            },

            "data": [
                {
                    "type":
                        "sentinel-2-l2a",

                    "dataFilter": {
                        "timeRange": {
                            "from":
                                f"{date_only}T00:00:00Z",

                            "to":
                                f"{date_only}T23:59:59Z",
                        },

                        "mosaickingOrder":
                            "leastCC",
                    },
                }
            ],
        },

        "output": {
            "width": 768,
            "height": 768,

            "responses": [
                {
                    "identifier": "default",

                    "format": {
                        "type":
                            "image/tiff"
                    },
                }
            ],
        },

        "evalscript":
            evalscript,
    }

    headers = {
        "Authorization":
            f"Bearer {access_token}",

        "Content-Type":
            "application/json",

        "Accept":
            "image/tiff",
    }

    # --------------------------------------------------------
    # CALL COPERNICUS PROCESS API
    # --------------------------------------------------------

    try:

        response = requests.post(
            CDSE_PROCESS_URL,
            headers=headers,
            json=request_body,
            timeout=180,
        )

        print(
            "CDSE NDVI STATUS:",
            response.status_code,
        )

        # ----------------------------------------------------
        # TOKEN EXPIRED -> REFRESH
        # ----------------------------------------------------

        if response.status_code == 401:

            CDSE_ACCESS_TOKEN = None
            CDSE_TOKEN_EXPIRES_AT = 0

            access_token = (
                get_cdse_access_token()
            )

            headers["Authorization"] = (
                f"Bearer {access_token}"
            )

            response = requests.post(
                CDSE_PROCESS_URL,
                headers=headers,
                json=request_body,
                timeout=180,
            )

            print(
                "CDSE NDVI RETRY STATUS:",
                response.status_code,
            )

        # ----------------------------------------------------
        # ERROR
        # ----------------------------------------------------

        if response.status_code != 200:

            try:
                details = response.json()

            except Exception:
                details = response.text[:3000]

            return {
                "success": False,
                "error": (
                    "Sentinel-2 NDVI request failed: "
                    f"{response.status_code}"
                ),
                "details": details,
            }

        # ----------------------------------------------------
        # READ TIFF
        # ----------------------------------------------------

        if not response.content:

            return {
                "success": False,
                "error":
                    "Copernicus returned empty NDVI data.",
            }

        try:

            ndvi_image = Image.open(
                io.BytesIO(
                    response.content
                )
            )

            ndvi_array = np.array(
                ndvi_image,
                dtype=np.float32
            )

        except Exception as exc:

            return {
                "success": False,
                "error":
                    "Unable to decode NDVI raster.",
                "details":
                    str(exc),
            }

        # ----------------------------------------------------
        # CLEAN NDVI DATA
        # ----------------------------------------------------

        valid_mask = (
            np.isfinite(ndvi_array)
            &
            (ndvi_array > -1.0)
            &
            (ndvi_array <= 1.0)
        )

        valid_values = (
            ndvi_array[valid_mask]
        )

        if valid_values.size == 0:

            return {
                "success": False,
                "error":
                    "No valid NDVI pixels were returned.",
            }

        # ----------------------------------------------------
        # STATISTICS
        # ----------------------------------------------------

        mean_ndvi = float(
            np.mean(valid_values)
        )

        min_ndvi = float(
            np.min(valid_values)
        )

        max_ndvi = float(
            np.max(valid_values)
        )

        # ----------------------------------------------------
        # VEGETATION MASK
        #
        # NDVI > 0.20 = vegetation
        # ----------------------------------------------------

        vegetation_pixels = (
            valid_values > 0.20
        ).sum()

        total_valid_pixels = (
            valid_values.size
        )

        vegetation_percentage = (
            vegetation_pixels
            / total_valid_pixels
        ) * 100

        # ----------------------------------------------------
        # VEGETATION HEALTH
        # ----------------------------------------------------

        if mean_ndvi >= 0.60:

            health = "Excellent"

        elif mean_ndvi >= 0.40:

            health = "Healthy"

        elif mean_ndvi >= 0.20:

            health = "Moderate"

        elif mean_ndvi >= 0.00:

            health = "Sparse"

        else:

            health = "Very Low"

        # ----------------------------------------------------
        # CREATE NDVI VISUALIZATION
        ndvi_map = create_index_visualization(ndvi_array, valid_mask, "ndvi")

        # ENCODE NDVI MAP
        # ----------------------------------------------------

        output = io.BytesIO()

        ndvi_map.save(
            output,
            format="PNG",
            optimize=True
        )

        encoded = base64.b64encode(
            output.getvalue()
        ).decode("utf-8")

        image_data_url = (
            "data:image/png;base64,"
            + encoded
        )

        # ----------------------------------------------------
        # RESULT
        # ----------------------------------------------------

        return {

            "success": True,

            "date":
                date_only,

            "product":
                "Sentinel-2 L2A",

            "bands": [
                "B04",
                "B08",
            ],

            "formula":
                "(B08 - B04) / (B08 + B04)",

            "mean_ndvi":
                round(
                    mean_ndvi,
                    4
                ),

            "min_ndvi":
                round(
                    min_ndvi,
                    4
                ),

            "max_ndvi":
                round(
                    max_ndvi,
                    4
                ),

            "vegetation_percentage":
                round(
                    vegetation_percentage,
                    2
                ),

            "vegetation_health":
                health,

            "valid_pixels":
                int(
                    total_valid_pixels
                ),

            "width":
                int(
                    ndvi_array.shape[1]
                ),

            "height":
                int(
                    ndvi_array.shape[0]
                ),

            "ndvi_map":
                image_data_url,

        }

    except requests.RequestException as exc:

        print(
            "CDSE NDVI REQUEST ERROR:",
            str(exc),
        )

        return {
            "success": False,
            "error": (
                "Unable to connect to the "
                "Sentinel-2 Process API."
            ),
            "details": str(exc),
        }

    except Exception as exc:

        print(
            "CDSE NDVI UNEXPECTED ERROR:",
            str(exc),
        )

        return {
            "success": False,
            "error":
                "Unexpected NDVI processing error.",
            "details":
                str(exc),
        }
# ============================================================
# SENTINEL-2 NDWI ANALYSIS
# ============================================================

@app.post("/api/satellite-ndwi")
async def satellite_ndwi(
    west: float = Form(...),
    south: float = Form(...),
    east: float = Form(...),
    north: float = Form(...),
    acquisition_date: str = Form(...),
):
    """
    Calculate NDWI from Sentinel-2 L2A.

    B03 = Green
    B08 = Near Infrared (NIR)

    NDWI = (Green - NIR) / (Green + NIR)
    """

    global CDSE_ACCESS_TOKEN
    global CDSE_TOKEN_EXPIRES_AT

    # --------------------------------------------------------
    # VALIDATE COORDINATES
    # --------------------------------------------------------

    try:
        west = float(west)
        south = float(south)
        east = float(east)
        north = float(north)

    except (TypeError, ValueError):
        return {
            "success": False,
            "error": "Invalid AOI coordinates.",
        }

    if not (
        -180 <= west <= 180
        and -180 <= east <= 180
        and -90 <= south <= 90
        and -90 <= north <= 90
    ):
        return {
            "success": False,
            "error": (
                "Coordinates are outside valid WGS84 limits."
            ),
        }

    if west >= east:
        return {
            "success": False,
            "error": "West must be less than East.",
        }

    if south >= north:
        return {
            "success": False,
            "error": "South must be less than North.",
        }

    # --------------------------------------------------------
    # VALIDATE DATE
    # --------------------------------------------------------

    acquisition_date = (
        acquisition_date or ""
    ).strip()

    if not acquisition_date:
        return {
            "success": False,
            "error": "Acquisition date is required.",
        }

    date_only = acquisition_date[:10]

    from datetime import datetime

    try:
        datetime.strptime(
            date_only,
            "%Y-%m-%d",
        )

    except ValueError:
        return {
            "success": False,
            "error": (
                "Invalid acquisition date. "
                "Expected YYYY-MM-DD."
            ),
        }

    # --------------------------------------------------------
    # AUTHENTICATION
    # --------------------------------------------------------

    try:
        access_token = get_cdse_access_token()

    except Exception as exc:
        print(
            "CDSE NDWI AUTH ERROR:",
            str(exc),
        )

        return {
            "success": False,
            "error": (
                "Unable to authenticate with "
                "Copernicus Data Space."
            ),
            "details": str(exc),
        }

    # --------------------------------------------------------
    # NDWI EVALSCRIPT
    #
    # B03 = Green
    # B08 = NIR
    #
    # SCL masks:
    # 3  = cloud shadow
    # 8  = cloud medium probability
    # 9  = cloud high probability
    # 10 = cirrus
    # 11 = snow / ice
    # --------------------------------------------------------

    evalscript = """
//VERSION=3

function setup() {
  return {
    input: [
      "B03",
      "B08",
      "SCL"
    ],
    output: {
      bands: 1,
      sampleType: "FLOAT32"
    }
  };
}

function evaluatePixel(sample) {

  if (
    sample.SCL === 3 ||
    sample.SCL === 8 ||
    sample.SCL === 9 ||
    sample.SCL === 10 ||
    sample.SCL === 11
  ) {
    return [-9999];
  }

  var green = sample.B03;
  var nir = sample.B08;

  var denominator = green + nir;

  if (denominator === 0) {
    return [-9999];
  }

  var ndwi = (green - nir) / denominator;

  return [ndwi];
}
"""

    # --------------------------------------------------------
    # COPERNICUS PROCESS REQUEST
    # --------------------------------------------------------

    request_body = {
        "input": {
            "bounds": {
                "bbox": [
                    west,
                    south,
                    east,
                    north,
                ],
                "properties": {
                    "crs":
                        "http://www.opengis.net/def/crs/OGC/1.3/CRS84"
                },
            },

            "data": [
                {
                    "type":
                        "sentinel-2-l2a",

                    "dataFilter": {
                        "timeRange": {
                            "from":
                                f"{date_only}T00:00:00Z",

                            "to":
                                f"{date_only}T23:59:59Z",
                        },

                        "mosaickingOrder":
                            "leastCC",
                    },
                }
            ],
        },

        "output": {
            "width": 768,
            "height": 768,

            "responses": [
                {
                    "identifier": "default",

                    "format": {
                        "type":
                            "image/tiff"
                    },
                }
            ],
        },

        "evalscript":
            evalscript,
    }

    headers = {
        "Authorization":
            f"Bearer {access_token}",

        "Content-Type":
            "application/json",

        "Accept":
            "image/tiff",
    }

    # --------------------------------------------------------
    # CALL COPERNICUS PROCESS API
    # --------------------------------------------------------

    try:

        response = requests.post(
            CDSE_PROCESS_URL,
            headers=headers,
            json=request_body,
            timeout=180,
        )

        print(
            "CDSE NDWI STATUS:",
            response.status_code,
        )

        # ----------------------------------------------------
        # TOKEN EXPIRED -> REFRESH
        # ----------------------------------------------------

        if response.status_code == 401:

            CDSE_ACCESS_TOKEN = None
            CDSE_TOKEN_EXPIRES_AT = 0

            access_token = (
                get_cdse_access_token()
            )

            headers["Authorization"] = (
                f"Bearer {access_token}"
            )

            response = requests.post(
                CDSE_PROCESS_URL,
                headers=headers,
                json=request_body,
                timeout=180,
            )

            print(
                "CDSE NDWI RETRY STATUS:",
                response.status_code,
            )

        # ----------------------------------------------------
        # ERROR
        # ----------------------------------------------------

        if response.status_code != 200:

            try:
                details = response.json()

            except Exception:
                details = response.text[:3000]

            return {
                "success": False,

                "error": (
                    "Sentinel-2 NDWI request failed: "
                    f"{response.status_code}"
                ),

                "details": details,
            }

        # ----------------------------------------------------
        # READ TIFF
        # ----------------------------------------------------

        if not response.content:
            return {
                "success": False,
                "error":
                    "Copernicus returned empty NDWI data.",
            }

        try:

            ndwi_image = Image.open(
                io.BytesIO(
                    response.content
                )
            )

            ndwi_array = np.array(
                ndwi_image,
                dtype=np.float32
            )

        except Exception as exc:

            return {
                "success": False,

                "error":
                    "Unable to decode NDWI raster.",

                "details":
                    str(exc),
            }

        # ----------------------------------------------------
        # CLEAN NDWI DATA
        # ----------------------------------------------------

        valid_mask = (
            np.isfinite(ndwi_array)
            &
            (ndwi_array > -1.0)
            &
            (ndwi_array <= 1.0)
        )

        valid_values = (
            ndwi_array[valid_mask]
        )

        if valid_values.size == 0:

            return {
                "success": False,
                "error":
                    "No valid NDWI pixels were returned.",
            }

        # ----------------------------------------------------
        # STATISTICS
        # ----------------------------------------------------

        mean_ndwi = float(
            np.mean(valid_values)
        )

        min_ndwi = float(
            np.min(valid_values)
        )

        max_ndwi = float(
            np.max(valid_values)
        )

        # ----------------------------------------------------
        # WATER MASK
        #
        # NDWI > 0.20 = water
        # ----------------------------------------------------

        water_pixels = (
            valid_values > 0.20
        ).sum()

        total_valid_pixels = (
            valid_values.size
        )

        water_percentage = (
            water_pixels
            / total_valid_pixels
        ) * 100

        # ----------------------------------------------------
        # WATER STATUS
        # ----------------------------------------------------

        if mean_ndwi >= 0.50:
            water_status = "Strong Water Presence"

        elif mean_ndwi >= 0.20:
            water_status = "Moderate Water Presence"

        elif mean_ndwi >= 0.00:
            water_status = "Low Water Presence"

        else:
            water_status = "Very Low Water Presence"

        # ----------------------------------------------------
        # CREATE NDWI VISUALIZATION
        ndwi_map = create_index_visualization(ndwi_array, valid_mask, "ndwi")

        # ENCODE NDWI MAP
        # ----------------------------------------------------

        output = io.BytesIO()

        ndwi_map.save(
            output,
            format="PNG",
            optimize=True
        )

        encoded = base64.b64encode(
            output.getvalue()
        ).decode("utf-8")

        image_data_url = (
            "data:image/png;base64,"
            + encoded
        )

        # ----------------------------------------------------
        # RESULT
        # ----------------------------------------------------

        return {

            "success": True,

            "date":
                date_only,

            "product":
                "Sentinel-2 L2A",

            "bands": [
                "B03",
                "B08",
            ],

            "formula":
                "(B03 - B08) / (B03 + B08)",

            "mean_ndwi":
                round(
                    mean_ndwi,
                    4
                ),

            "min_ndwi":
                round(
                    min_ndwi,
                    4
                ),

            "max_ndwi":
                round(
                    max_ndwi,
                    4
                ),

            "water_percentage":
                round(
                    water_percentage,
                    2
                ),

            "water_status":
                water_status,

            "valid_pixels":
                int(
                    total_valid_pixels
                ),

            "width":
                int(
                    ndwi_array.shape[1]
                ),

            "height":
                int(
                    ndwi_array.shape[0]
                ),

            "ndwi_map":
                image_data_url,
        }

    except requests.RequestException as exc:

        print(
            "CDSE NDWI REQUEST ERROR:",
            str(exc),
        )

        return {
            "success": False,

            "error": (
                "Unable to connect to the "
                "Sentinel-2 Process API."
            ),

            "details":
                str(exc),
        }

    except Exception as exc:

        print(
            "CDSE NDWI UNEXPECTED ERROR:",
            str(exc),
        )

        return {
            "success": False,

            "error":
                "Unexpected NDWI processing error.",

            "details":
                str(exc),
        }
# ============================================================
# SENTINEL-2 NDBI ANALYSIS
# ============================================================

@app.post("/api/satellite-ndbi")
async def satellite_ndbi(
    west: float = Form(...),
    south: float = Form(...),
    east: float = Form(...),
    north: float = Form(...),
    acquisition_date: str = Form(...),
):
    """
    Calculate NDBI from Sentinel-2 L2A.

    B11 = SWIR
    B08 = NIR

    NDBI = (SWIR - NIR) / (SWIR + NIR)
    """

    global CDSE_ACCESS_TOKEN
    global CDSE_TOKEN_EXPIRES_AT

    # --------------------------------------------------------
    # VALIDATE COORDINATES
    # --------------------------------------------------------

    try:
        west = float(west)
        south = float(south)
        east = float(east)
        north = float(north)

    except (TypeError, ValueError):
        return {
            "success": False,
            "error": "Invalid AOI coordinates.",
        }

    if not (
        -180 <= west <= 180
        and -180 <= east <= 180
        and -90 <= south <= 90
        and -90 <= north <= 90
    ):
        return {
            "success": False,
            "error": "Coordinates are outside valid WGS84 limits.",
        }

    if west >= east:
        return {
            "success": False,
            "error": "West must be less than East.",
        }

    if south >= north:
        return {
            "success": False,
            "error": "South must be less than North.",
        }

    # --------------------------------------------------------
    # VALIDATE DATE
    # --------------------------------------------------------

    acquisition_date = (
        acquisition_date or ""
    ).strip()

    if not acquisition_date:
        return {
            "success": False,
            "error": "Acquisition date is required.",
        }

    date_only = acquisition_date[:10]

    from datetime import datetime

    try:
        datetime.strptime(
            date_only,
            "%Y-%m-%d",
        )

    except ValueError:
        return {
            "success": False,
            "error": (
                "Invalid acquisition date. "
                "Expected YYYY-MM-DD."
            ),
        }

    # --------------------------------------------------------
    # AUTHENTICATION
    # --------------------------------------------------------

    try:
        access_token = get_cdse_access_token()

    except Exception as exc:
        print(
            "CDSE NDBI AUTH ERROR:",
            str(exc),
        )

        return {
            "success": False,
            "error": (
                "Unable to authenticate with "
                "Copernicus Data Space."
            ),
            "details": str(exc),
        }

    # --------------------------------------------------------
    # NDBI EVALSCRIPT
    #
    # B11 = SWIR
    # B08 = NIR
    #
    # SCL cloud masking
    # --------------------------------------------------------

    evalscript = """
//VERSION=3

function setup() {
  return {
    input: [
      "B08",
      "B11",
      "SCL"
    ],
    output: {
      bands: 1,
      sampleType: "FLOAT32"
    }
  };
}

function evaluatePixel(sample) {

  if (
    sample.SCL === 3 ||
    sample.SCL === 8 ||
    sample.SCL === 9 ||
    sample.SCL === 10 ||
    sample.SCL === 11
  ) {
    return [-9999];
  }

  var nir = sample.B08;
  var swir = sample.B11;

  var denominator = swir + nir;

  if (denominator === 0) {
    return [-9999];
  }

  var ndbi = (swir - nir) / denominator;

  return [ndbi];
}
"""

    # --------------------------------------------------------
    # COPERNICUS PROCESS REQUEST
    # --------------------------------------------------------

    request_body = {
        "input": {
            "bounds": {
                "bbox": [
                    west,
                    south,
                    east,
                    north,
                ],
                "properties": {
                    "crs":
                        "http://www.opengis.net/def/crs/OGC/1.3/CRS84"
                },
            },

            "data": [
                {
                    "type":
                        "sentinel-2-l2a",

                    "dataFilter": {
                        "timeRange": {
                            "from":
                                f"{date_only}T00:00:00Z",

                            "to":
                                f"{date_only}T23:59:59Z",
                        },

                        "mosaickingOrder":
                            "leastCC",
                    },
                }
            ],
        },

        "output": {
            "width": 768,
            "height": 768,

            "responses": [
                {
                    "identifier": "default",

                    "format": {
                        "type":
                            "image/tiff"
                    },
                }
            ],
        },

        "evalscript":
            evalscript,
    }

    headers = {
        "Authorization":
            f"Bearer {access_token}",

        "Content-Type":
            "application/json",

        "Accept":
            "image/tiff",
    }

    # --------------------------------------------------------
    # CALL COPERNICUS PROCESS API
    # --------------------------------------------------------

    try:

        response = requests.post(
            CDSE_PROCESS_URL,
            headers=headers,
            json=request_body,
            timeout=180,
        )

        print(
            "CDSE NDBI STATUS:",
            response.status_code,
        )

        # ----------------------------------------------------
        # TOKEN EXPIRED -> REFRESH
        # ----------------------------------------------------

        if response.status_code == 401:

            CDSE_ACCESS_TOKEN = None
            CDSE_TOKEN_EXPIRES_AT = 0

            access_token = (
                get_cdse_access_token()
            )

            headers["Authorization"] = (
                f"Bearer {access_token}"
            )

            response = requests.post(
                CDSE_PROCESS_URL,
                headers=headers,
                json=request_body,
                timeout=180,
            )

            print(
                "CDSE NDBI RETRY STATUS:",
                response.status_code,
            )

        # ----------------------------------------------------
        # ERROR
        # ----------------------------------------------------

        if response.status_code != 200:

            try:
                details = response.json()

            except Exception:
                details = response.text[:3000]

            return {
                "success": False,
                "error": (
                    "Sentinel-2 NDBI request failed: "
                    f"{response.status_code}"
                ),
                "details": details,
            }

        # ----------------------------------------------------
        # READ TIFF
        # ----------------------------------------------------

        if not response.content:
            return {
                "success": False,
                "error":
                    "Copernicus returned empty NDBI data.",
            }

        try:

            image = Image.open(
                io.BytesIO(response.content)
            )

            image = image.convert("F")

            ndbi_array = np.array(
                image,
                dtype=np.float32,
            )

        except Exception as exc:

            return {
                "success": False,
                "error":
                    "Unable to decode NDBI TIFF.",
                "details": str(exc),
            }

        # ----------------------------------------------------
        # VALID PIXELS
        # ----------------------------------------------------

        valid_mask = (
            np.isfinite(ndbi_array)
            &
            (ndbi_array > -1.0)
            &
            (ndbi_array <= 1.0)
        )

        valid_values = (
            ndbi_array[valid_mask]
        )

        if valid_values.size == 0:

            return {
                "success": False,
                "error":
                    "No valid NDBI pixels were returned.",
            }

        # ----------------------------------------------------
        # STATISTICS
        # ----------------------------------------------------

        mean_ndbi = float(
            np.mean(valid_values)
        )

        min_ndbi = float(
            np.min(valid_values)
        )

        max_ndbi = float(
            np.max(valid_values)
        )

        # ----------------------------------------------------
        # BUILT-UP MASK
        #
        # NDBI > 0.20 = built-up indication
        # ----------------------------------------------------

        builtup_pixels = (
            valid_values > 0.20
        ).sum()

        total_valid_pixels = (
            valid_values.size
        )

        builtup_percentage = (
            builtup_pixels
            / total_valid_pixels
        ) * 100

        # ----------------------------------------------------
        # BUILT-UP STATUS
        # ----------------------------------------------------

        if mean_ndbi >= 0.40:

            builtup_status = (
                "Very High Built-up Intensity"
            )

        elif mean_ndbi >= 0.20:

            builtup_status = (
                "High Built-up Intensity"
            )

        elif mean_ndbi >= 0.00:

            builtup_status = (
                "Moderate Built-up Intensity"
            )

        else:

            builtup_status = (
                "Low Built-up Intensity"
            )

        # ----------------------------------------------------
        # CREATE NDBI VISUALIZATION
        ndbi_map = create_index_visualization(ndbi_array, valid_mask, "ndbi")

        # ENCODE NDBI MAP
        # ----------------------------------------------------

        output = io.BytesIO()

        ndbi_map.save(
            output,
            format="PNG",
            optimize=True,
        )

        encoded = base64.b64encode(
            output.getvalue()
        ).decode("utf-8")

        image_data_url = (
            "data:image/png;base64,"
            + encoded
        )

        # ----------------------------------------------------
        # RESULT
        # ----------------------------------------------------

        return {
            "success": True,

            "date":
                date_only,

            "product":
                "Sentinel-2 L2A",

            "bands": [
                "B11",
                "B08",
            ],

            "formula":
                "(B11 - B08) / (B11 + B08)",

            "mean_ndbi":
                round(
                    mean_ndbi,
                    4,
                ),

            "min_ndbi":
                round(
                    min_ndbi,
                    4,
                ),

            "max_ndbi":
                round(
                    max_ndbi,
                    4,
                ),

            "builtup_percentage":
                round(
                    float(
                        builtup_percentage
                    ),
                    2,
                ),

            "builtup_status":
                builtup_status,

            "valid_pixels":
                int(total_valid_pixels),

            "width":
                int(ndbi_array.shape[1]),

            "height":
                int(ndbi_array.shape[0]),

            "ndbi_map":
                image_data_url,
        }

    except Exception as exc:

        print(
            "NDBI PROCESS ERROR:",
            str(exc),
        )

        return {
            "success": False,
            "error":
                "Unexpected Sentinel-2 NDBI error.",
            "details": str(exc),
        }
# ============================================================
# VQA
# ============================================================

@app.post("/api/vqa")
async def vqa(
    image: UploadFile = File(...),
    question: str = Form(...),
):

    if not question.strip():

        return {
            "success": False,
            "error": (
                "Question cannot be empty."
            ),
        }


    allowed = {
        ".png",
        ".jpg",
        ".jpeg",
        ".tif",
        ".tiff",
        ".jp2",
        ".j2k",
        ".nitf",
    }


    filename = (
        image.filename
        or "satellite"
    )

    ext = extension(
        filename
    )


    if ext not in allowed:

        return {
            "success": False,
            "error": (
                "Unsupported image format. "
                "Use PNG, JPG/JPEG, GeoTIFF, "
                "JP2/J2K or NITF."
            ),
        }


    image_bytes = await image.read()


    if not image_bytes:

        return {
            "success": False,
            "error": (
                "Uploaded image is empty."
            ),
        }


    max_upload_size = (
        50 * 1024 * 1024
    )


    if len(image_bytes) > max_upload_size:

        return {
            "success": False,
            "error": (
                "Maximum image size is 50 MB."
            ),
        }


    try:

        (
            image_data_url,
            width,
            height,
            ai_size,
        ) = make_ai_image(
            image_bytes,
            filename
        )

    except ValueError as exc:

        return {
            "success": False,
            "error": str(exc)
        }


    if not HF_TOKEN:

        return {
            "success": True,
            "mode": "demo",
            "provider": "demo",
            "question": question.strip(),
            "answer": (
                "Demo VQA response. Add HF_TOKEN "
                "in backend/.env to enable live "
                "satellite-image question answering."
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
                            "You are SatQuery AI, a "
                            "satellite imagery analysis "
                            "assistant.\n\n"

                            "Analyze ONLY the provided "
                            "satellite image.\n\n"

                            "Answer the user's question "
                            "using only information that "
                            "is actually visible in the image.\n\n"

                            "Do not invent objects, "
                            "locations, buildings, roads, "
                            "water bodies or other details.\n\n"

                            "If something cannot be "
                            "determined from the image, "
                            "clearly say so.\n\n"

                            "Give a concise and factual answer.\n\n"

                            f"User question: "
                            f"{question.strip()}"
                        ),
                    },

                    {
                        "type": "image_url",

                        "image_url": {
                            "url": image_data_url
                        },
                    },

                ],
            }

        ],

        "max_tokens": 600,
    }


    headers = {

        "Authorization":
            f"Bearer {HF_TOKEN}",

        "Content-Type":
            "application/json",

        "Accept":
            "application/json",
    }


    try:

        response = requests.post(
            HF_URL,
            headers=headers,
            json=payload,
            timeout=120,
        )


        print(
            "HUGGING FACE VQA STATUS:",
            response.status_code
        )

        print(
            "HUGGING FACE VQA RESPONSE:",
            response.text[:2000]
        )


        if response.status_code != 200:

            try:
                error_data = response.json()

            except Exception:
                error_data = response.text

            return {
                "success": False,
                "error": (
                    f"AI API error: "
                    f"{response.status_code}"
                ),
                "details": error_data,
            }


        try:
            data = response.json()

        except ValueError:

            return {
                "success": False,
                "error": (
                    "AI returned invalid JSON."
                ),
                "details": response.text[:2000],
            }


        if (
            "choices" not in data
            or not data["choices"]
        ):

            return {
                "success": False,
                "error": (
                    "AI returned an unexpected response."
                ),
                "details": data,
            }


        message = (
            data["choices"][0]
            .get(
                "message",
                {}
            )
        )


        answer = (
            message.get("content")
            or
            message.get(
                "reasoning_content"
            )
            or ""
        )


        if not answer:

            return {
                "success": False,
                "error": (
                    "AI response did not contain "
                    "an answer."
                ),
                "details": data,
            }


        return {

            "success": True,

            "mode": "live",

            "provider": "huggingface",

            "model": HF_MODEL,

            "question":
                question.strip(),

            "answer":
                answer,

            "image_width":
                width,

            "image_height":
                height,

            "ai_payload_kb":
                round(
                    ai_size / 1024,
                    1
                ),
        }


    except requests.RequestException as exc:

        return {
            "success": False,
            "error": (
                "Unable to connect to AI service."
            ),
            "details": str(exc),
        }


    except Exception as exc:

        return {
            "success": False,
            "error": (
                "Unexpected AI error."
            ),
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

        # ----------------------------------------------------
        # READ FILES
        # ----------------------------------------------------

        before_bytes = (
            await before_image.read()
        )

        after_bytes = (
            await after_image.read()
        )


        if (
            not before_bytes
            or not after_bytes
        ):

            return {
                "success": False,
                "error": (
                    "Both before and after "
                    "images are required."
                ),
            }


        # ----------------------------------------------------
        # SAME-AREA VALIDATION
        # ----------------------------------------------------

        validation = validate_same_area_cv(
            before_bytes,
            after_bytes
        )


        print(
            "CV SAME AREA RESULT:",
            validation
        )


        if not validation["same_area"]:

            return {

                "success": False,

                "error": (
                    "These images appear to "
                    "represent different areas. "
                    "Please upload before and "
                    "after images of the same "
                    "location."
                ),

                "validation": {
                    "same_area": False,

                    "confidence":
                        validation.get(
                            "confidence"
                        ),

                    "good_matches":
                        validation.get(
                            "good_matches"
                        ),

                    "inliers":
                        validation.get(
                            "inliers"
                        ),

                    "inlier_ratio":
                        validation.get(
                            "inlier_ratio"
                        ),

                    "reason":
                        validation.get(
                            "reason"
                        ),
                },
            }


        # ----------------------------------------------------
        # DECODE IMAGES
        # ----------------------------------------------------

        before = Image.open(
            io.BytesIO(
                before_bytes
            )
        )

        after = Image.open(
            io.BytesIO(
                after_bytes
            )
        )


        before = ImageOps.exif_transpose(
            before
        ).convert("RGB")


        after = ImageOps.exif_transpose(
            after
        ).convert("RGB")


        # ----------------------------------------------------
        # RESIZE
        # ----------------------------------------------------

        width = 900

        height = round(
            width
            * (
                after.height
                / after.width
            )
        )


        before = before.resize(
            (
                width,
                height
            ),
            Image.Resampling.LANCZOS
        )


        after = after.resize(
            (
                width,
                height
            ),
            Image.Resampling.LANCZOS
        )


        # ----------------------------------------------------
        # PIXELS
        # ----------------------------------------------------

        before_pixels = (
            before.load()
        )

        after_pixels = (
            after.load()
        )


        change_map = Image.new(
            "RGB",
            (
                width,
                height
            ),
            (
                35,
                35,
                35
            )
        )


        output_pixels = (
            change_map.load()
        )


        # ----------------------------------------------------
        # THRESHOLD
        # ----------------------------------------------------

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


        # ----------------------------------------------------
        # PIXEL COMPARISON
        # ----------------------------------------------------

        for y in range(height):

            for x in range(width):

                r1, g1, b1 = (
                    before_pixels[x, y]
                )


                r2, g2, b2 = (
                    after_pixels[x, y]
                )


                difference = (

                    abs(
                        r1 - r2
                    )

                    +

                    abs(
                        g1 - g2
                    )

                    +

                    abs(
                        b1 - b2
                    )

                )


                if difference > (
                    threshold * 3
                ):

                    changed_pixels += 1


                    category = (
                        classify_land_pixel(
                            r2,
                            g2,
                            b2
                        )
                    )


                    categories[
                        category
                    ] += 1


                    output_pixels[x, y] = (
                        category_to_color(
                            category
                        )
                    )


                else:

                    gray = int(

                        (
                            (
                                r2
                                + g2
                                + b2
                            )

                            / 3

                        ) * 0.22

                    )


                    output_pixels[x, y] = (

                        gray,
                        gray,
                        gray

                    )


        # ----------------------------------------------------
        # STATISTICS
        # ----------------------------------------------------

        total_pixels = (
            width * height
        )


        overall_change = (

            changed_pixels
            / total_pixels

        ) * 100


        category_percentages = {

            category: round(

                (
                    count
                    / total_pixels
                ) * 100,

                2

            )

            for category, count
            in categories.items()

        }


        # ----------------------------------------------------
        # ENCODE CHANGE MAP
        # ----------------------------------------------------

        output = io.BytesIO()


        change_map.save(
            output,
            format="PNG",
            optimize=True
        )


        encoded = base64.b64encode(
            output.getvalue()
        ).decode("utf-8")


        image_data_url = (
            "data:image/png;base64,"
            + encoded
        )


        # ----------------------------------------------------
        # RESULT
        # ----------------------------------------------------

        return {

            "success": True,

            "mode":
                "visual-classification",

            "before_date":
                before_date,

            "after_date":
                after_date,

            "width":
                width,

            "height":
                height,

            "overall_change":
                round(
                    overall_change,
                    2
                ),

            "categories":
                category_percentages,

            "category_pixels":
                categories,

            "change_map":
                image_data_url,

            "same_area_validated":
                True,

            "same_area_confidence":
                validation.get(
                    "confidence"
                ),

        }


    except Exception as exc:

        print(
            "CHANGE DETECTION ERROR:",
            str(exc)
        )


        return {

            "success": False,

            "error": (
                "Unable to process "
                "change detection."
            ),

            "details":
                str(exc),

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

        before_bytes = (
            await before_image.read()
        )

        after_bytes = (
            await after_image.read()
        )


        if (
            not before_bytes
            or not after_bytes
        ):

            return {

                "success": False,

                "error": (
                    "Both before and after "
                    "images are required."
                ),

            }


        # ----------------------------------------------------
        # Create AI images
        # ----------------------------------------------------

        before_url, _, _, _ = (
            make_ai_image(

                before_bytes,

                before_image.filename
                or "before.jpg"

            )
        )


        after_url, _, _, _ = (
            make_ai_image(

                after_bytes,

                after_image.filename
                or "after.jpg"

            )
        )


        category_text = (
            categories
            or "{}"
        )


        # ----------------------------------------------------
        # AI Prompt
        # ----------------------------------------------------

        prompt = f"""
You are SatQuery AI, an expert assistant
for satellite change detection.

Compare the BEFORE and AFTER satellite
images carefully.

Use ONLY visible evidence from the two
images.

Do not invent exact objects, locations,
causes, coordinates, or measurements that
cannot be determined from the images.

Observation period:

Before date:
{before_date or "Not provided"}

After date:
{after_date or "Not provided"}

Detected visual change:
{overall_change or "Not provided"}%

Detected category statistics:
{category_text}

Provide a concise interpretation with
these points:

1. Major visible changes.
2. Land-cover categories that changed.
3. Vegetation change.
4. Built-up/urban change.
5. Water-body change.
6. Other visible land-use changes.

Important:
- Distinguish visible evidence from uncertainty.
- Do not claim exact numerical changes unless
  provided above.
- Keep the answer concise and factual.
"""


        if not HF_TOKEN:

            return {

                "success": True,

                "mode": "demo",

                "provider": "demo",

                "interpretation": (
                    "AI change interpretation "
                    "is in demo mode. Add HF_TOKEN "
                    "to enable live analysis."
                ),

            }


        payload = {

            "model": HF_MODEL,

            "messages": [

                {

                    "role": "user",

                    "content": [

                        {

                            "type": "text",

                            "text": prompt,

                        },

                        {

                            "type": "image_url",

                            "image_url": {

                                "url":
                                    before_url

                            },

                        },

                        {

                            "type": "image_url",

                            "image_url": {

                                "url":
                                    after_url

                            },

                        },

                    ],

                }

            ],

            "max_tokens": 700,

        }


        headers = {

            "Authorization":
                f"Bearer {HF_TOKEN}",

            "Content-Type":
                "application/json",

            "Accept":
                "application/json",

        }


        response = requests.post(

            HF_URL,

            headers=headers,

            json=payload,

            timeout=180,

        )


        print(
            "AI CHANGE STATUS:",
            response.status_code
        )

        print(
            "AI CHANGE RESPONSE:",
            response.text[:3000]
        )


        if response.status_code != 200:

            try:

                error_data = (
                    response.json()
                )

            except Exception:

                error_data = (
                    response.text
                )


            return {

                "success": False,

                "error": (
                    f"AI API error: "
                    f"{response.status_code}"
                ),

                "details":
                    error_data,

            }


        try:

            data = response.json()

        except ValueError:

            return {

                "success": False,

                "error": (
                    "AI returned invalid JSON."
                ),

                "details":
                    response.text[:2000],

            }


        if (
            "choices" not in data
            or not data["choices"]
        ):

            return {

                "success": False,

                "error": (
                    "AI returned an "
                    "unexpected response."
                ),

                "details":
                    data,

            }


        message = (
            data["choices"][0]
            .get(
                "message",
                {}
            )
        )


        interpretation = (

            message.get(
                "content"
            )

            or

            message.get(
                "reasoning_content"
            )

            or ""

        )


        if not interpretation:

            return {

                "success": False,

                "error": (
                    "AI response did not contain "
                    "an interpretation."
                ),

                "details":
                    data,

            }


        return {

            "success": True,

            "mode": "live",

            "provider":
                "huggingface",

            "model":
                HF_MODEL,

            "before_date":
                before_date,

            "after_date":
                after_date,

            "overall_change":
                overall_change,

            "categories":
                category_text,

            "interpretation":
                interpretation,

        }


    except requests.RequestException as exc:

        print(
            "AI CHANGE REQUEST ERROR:",
            str(exc)
        )


        return {

            "success": False,

            "error": (
                "Unable to connect to "
                "AI service."
            ),

            "details":
                str(exc),

        }


    except Exception as exc:

        print(
            "AI CHANGE UNEXPECTED ERROR:",
            str(exc)
        )


        return {

            "success": False,

            "error": (
                "Unexpected AI "
                "interpretation error."
            ),

            "details":
                str(exc),

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