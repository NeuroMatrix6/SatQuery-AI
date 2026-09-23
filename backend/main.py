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

try:
    import tifffile
except ImportError:
    tifffile = None

try:
    import rasterio
except ImportError:
    rasterio = None


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
    "https://stac.dataspace.copernicus.eu/"
    "v1/search"
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

    # Use the STAC Query extension for POST requests.
    # The current CDSE STAC endpoint expects JSON query
    # expressions for POST requests; sending CQL2 text as
    # the `filter` field can result in HTTP 400.
    if max_cloud_cover < 100:

        search_payload["query"] = {
            "eo:cloud_cover": {
                "lte": max_cloud_cover
            }
        }

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
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

                timeout=30,
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
# PHASE 6A + 6B — COMBINED LAND INTELLIGENCE
# ============================================================

@app.post("/api/combined-land-intelligence")
async def combined_land_intelligence(
    mean_ndvi: float = Form(...),
    vegetation_percentage: float = Form(...),
    mean_ndwi: float = Form(...),
    water_percentage: float = Form(...),
    mean_ndbi: float = Form(...),
    builtup_percentage: float = Form(...),
):
    """
    Phase 6A + 6B.

    Combines already-calculated NDVI, NDWI and NDBI statistics.
    This endpoint does NOT recalculate satellite indices.

    6A -> Common combined structure
    6B -> Land-characteristic classification
    """

    # --------------------------------------------------------
    # VALIDATE INDEX VALUES
    # --------------------------------------------------------
    if not (-1.0 <= mean_ndvi <= 1.0):
        return {
            "success": False,
            "error": "mean_ndvi must be between -1 and 1.",
        }

    if not (-1.0 <= mean_ndwi <= 1.0):
        return {
            "success": False,
            "error": "mean_ndwi must be between -1 and 1.",
        }

    if not (-1.0 <= mean_ndbi <= 1.0):
        return {
            "success": False,
            "error": "mean_ndbi must be between -1 and 1.",
        }

    # --------------------------------------------------------
    # VALIDATE PERCENTAGES
    # --------------------------------------------------------
    percentages = {
        "vegetation_percentage": vegetation_percentage,
        "water_percentage": water_percentage,
        "builtup_percentage": builtup_percentage,
    }

    for name, value in percentages.items():
        if not (0.0 <= value <= 100.0):
            return {
                "success": False,
                "error": f"{name} must be between 0 and 100.",
            }

    # --------------------------------------------------------
    # PHASE 6B — LAND CHARACTERISTICS
    # --------------------------------------------------------
    land_values = {
        "Vegetation": vegetation_percentage,
        "Water": water_percentage,
        "Built-up": builtup_percentage,
    }

    sorted_values = sorted(
        land_values.items(),
        key=lambda item: item[1],
        reverse=True,
    )

    dominant_type = sorted_values[0][0]
    dominant_percentage = float(sorted_values[0][1])
    second_highest = float(sorted_values[1][1])

    # If the two largest characteristics are close,
    # classify the area as mixed rather than forcing a dominant class.
    if dominant_percentage - second_highest < 10.0:
        land_characteristic = "Mixed Land Characteristics"
    else:
        land_characteristic = f"{dominant_type} Dominant"

    # --------------------------------------------------------
    # RESULT
    # --------------------------------------------------------
    return {
        "success": True,
        "module": "Combined Land Intelligence",
        "phase": "6A + 6B",
        "indices": {
            "ndvi": {
                "mean": round(float(mean_ndvi), 4),
                "vegetation_percentage": round(
                    float(vegetation_percentage), 2
                ),
            },
            "ndwi": {
                "mean": round(float(mean_ndwi), 4),
                "water_percentage": round(
                    float(water_percentage), 2
                ),
            },
            "ndbi": {
                "mean": round(float(mean_ndbi), 4),
                "builtup_percentage": round(
                    float(builtup_percentage), 2
                ),
            },
        },
        "summary": {
            "vegetation_percentage": round(
                float(vegetation_percentage), 2
            ),
            "water_percentage": round(
                float(water_percentage), 2
            ),
            "builtup_percentage": round(
                float(builtup_percentage), 2
            ),
        },
        "land_characteristics": {
            "dominant_type": dominant_type,
            "dominant_percentage": round(
                dominant_percentage, 2
            ),
            "classification": land_characteristic,
            "composition": {
                "vegetation": round(
                    float(vegetation_percentage), 2
                ),
                "water": round(
                    float(water_percentage), 2
                ),
                "builtup": round(
                    float(builtup_percentage), 2
                ),
            },
        },
        "status": "integrated",
    }

# ============================================================

# ============================================================
# PHASE 7 — MULTISPECTRAL CHANGE DETECTION
# ============================================================

def _safe_float(value, name):
    try:
        value = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be a valid number.")
    if not np.isfinite(value):
        raise ValueError(f"{name} must be finite.")
    return value


def _change_direction(delta, tolerance=0.02):
    if delta > tolerance:
        return "increase"
    if delta < -tolerance:
        return "decrease"
    return "stable"


@app.post("/api/multispectral-change-detection")
async def multispectral_change_detection(
    before_mean_ndvi: float = Form(...),
    after_mean_ndvi: float = Form(...),
    before_vegetation_percentage: float = Form(...),
    after_vegetation_percentage: float = Form(...),

    before_mean_ndwi: float = Form(...),
    after_mean_ndwi: float = Form(...),
    before_water_percentage: float = Form(...),
    after_water_percentage: float = Form(...),

    before_mean_ndbi: float = Form(...),
    after_mean_ndbi: float = Form(...),
    before_builtup_percentage: float = Form(...),
    after_builtup_percentage: float = Form(...),
):
    """
    Phase 7:
    Compare independently calculated Sentinel-2 NDVI, NDWI and NDBI
    statistics for the same AOI at two different times.

    The percentages are treated as category indicators from each
    independent index. They are NOT forced into a mutually-exclusive
    100% land-cover partition.
    """
    try:
        values = {
            "before_mean_ndvi": _safe_float(before_mean_ndvi, "before_mean_ndvi"),
            "after_mean_ndvi": _safe_float(after_mean_ndvi, "after_mean_ndvi"),
            "before_vegetation_percentage": _safe_float(
                before_vegetation_percentage, "before_vegetation_percentage"
            ),
            "after_vegetation_percentage": _safe_float(
                after_vegetation_percentage, "after_vegetation_percentage"
            ),
            "before_mean_ndwi": _safe_float(before_mean_ndwi, "before_mean_ndwi"),
            "after_mean_ndwi": _safe_float(after_mean_ndwi, "after_mean_ndwi"),
            "before_water_percentage": _safe_float(
                before_water_percentage, "before_water_percentage"
            ),
            "after_water_percentage": _safe_float(
                after_water_percentage, "after_water_percentage"
            ),
            "before_mean_ndbi": _safe_float(before_mean_ndbi, "before_mean_ndbi"),
            "after_mean_ndbi": _safe_float(after_mean_ndbi, "after_mean_ndbi"),
            "before_builtup_percentage": _safe_float(
                before_builtup_percentage, "before_builtup_percentage"
            ),
            "after_builtup_percentage": _safe_float(
                after_builtup_percentage, "after_builtup_percentage"
            ),
        }

        # Index values must remain within their scientific range.
        for key in (
            "before_mean_ndvi", "after_mean_ndvi",
            "before_mean_ndwi", "after_mean_ndwi",
            "before_mean_ndbi", "after_mean_ndbi",
        ):
            if not -1 <= values[key] <= 1:
                return {
                    "success": False,
                    "error": f"{key} must be between -1 and 1."
                }

        # Percentage indicators are bounded independently.
        for key in (
            "before_vegetation_percentage",
            "after_vegetation_percentage",
            "before_water_percentage",
            "after_water_percentage",
            "before_builtup_percentage",
            "after_builtup_percentage",
        ):
            if not 0 <= values[key] <= 100:
                return {
                    "success": False,
                    "error": f"{key} must be between 0 and 100."
                }

        def metric(before, after):
            delta = after - before
            return {
                "before": round(before, 4),
                "after": round(after, 4),
                "change": round(delta, 4),
                "direction": _change_direction(delta),
            }

        def percentage_metric(before, after):
            delta = after - before
            return {
                "before_percentage": round(before, 2),
                "after_percentage": round(after, 2),
                "change_percentage_points": round(delta, 2),
                "direction": _change_direction(delta, tolerance=1.0),
            }

        ndvi_change = metric(
            values["before_mean_ndvi"],
            values["after_mean_ndvi"],
        )
        vegetation_change = percentage_metric(
            values["before_vegetation_percentage"],
            values["after_vegetation_percentage"],
        )

        ndwi_change = metric(
            values["before_mean_ndwi"],
            values["after_mean_ndwi"],
        )
        water_change = percentage_metric(
            values["before_water_percentage"],
            values["after_water_percentage"],
        )

        ndbi_change = metric(
            values["before_mean_ndbi"],
            values["after_mean_ndbi"],
        )
        builtup_change = percentage_metric(
            values["before_builtup_percentage"],
            values["after_builtup_percentage"],
        )

        # Human-readable category interpretation based on the measured
        # percentage indicators and index direction.
        category_changes = []

        if vegetation_change["direction"] == "increase":
            category_changes.append("Vegetation gain")
        elif vegetation_change["direction"] == "decrease":
            category_changes.append("Vegetation loss")

        if water_change["direction"] == "increase":
            category_changes.append("Water increase")
        elif water_change["direction"] == "decrease":
            category_changes.append("Water decrease")

        if builtup_change["direction"] == "increase":
            category_changes.append("Built-up expansion")
        elif builtup_change["direction"] == "decrease":
            category_changes.append("Built-up reduction")

        if not category_changes:
            category_changes.append("No major category-level change")

        return {
            "success": True,
            "module": "Multispectral Change Detection",
            "phase": "7",
            "comparison": {
                "ndvi": ndvi_change,
                "vegetation": vegetation_change,
                "ndwi": ndwi_change,
                "water": water_change,
                "ndbi": ndbi_change,
                "builtup": builtup_change,
            },
            "interpretation": {
                "changes_detected": category_changes,
                "summary": ", ".join(category_changes),
            },
            "note": (
                "NDVI, NDWI and NDBI percentage indicators are calculated "
                "independently and may overlap; they are not a mutually "
                "exclusive 100% land-cover partition."
            ),
        }

    except ValueError as exc:
        return {
            "success": False,
            "error": str(exc),
        }
    except Exception as exc:
        print("MULTISPECTRAL CHANGE ERROR:", str(exc))
        return {
            "success": False,
            "error": "Unexpected multispectral change-detection error.",
            "details": str(exc),
        }


@app.post("/api/multispectral-change-ai-insight")
async def multispectral_change_ai_insight(
    before_mean_ndvi: float = Form(...),
    after_mean_ndvi: float = Form(...),
    before_vegetation_percentage: float = Form(...),
    after_vegetation_percentage: float = Form(...),

    before_mean_ndwi: float = Form(...),
    after_mean_ndwi: float = Form(...),
    before_water_percentage: float = Form(...),
    after_water_percentage: float = Form(...),

    before_mean_ndbi: float = Form(...),
    after_mean_ndbi: float = Form(...),
    before_builtup_percentage: float = Form(...),
    after_builtup_percentage: float = Form(...),

    change_summary: str = Form(""),
):
    """
    Phase 7 AI interpretation:
    provide the measured before/after multispectral evidence to the
    existing Hugging Face model and return a concise explanation.
    """
    try:
        numeric_fields = {
            "before_mean_ndvi": before_mean_ndvi,
            "after_mean_ndvi": after_mean_ndvi,
            "before_vegetation_percentage": before_vegetation_percentage,
            "after_vegetation_percentage": after_vegetation_percentage,
            "before_mean_ndwi": before_mean_ndwi,
            "after_mean_ndwi": after_mean_ndwi,
            "before_water_percentage": before_water_percentage,
            "after_water_percentage": after_water_percentage,
            "before_mean_ndbi": before_mean_ndbi,
            "after_mean_ndbi": after_mean_ndbi,
            "before_builtup_percentage": before_builtup_percentage,
            "after_builtup_percentage": after_builtup_percentage,
        }

        for key, value in numeric_fields.items():
            numeric_fields[key] = _safe_float(value, key)

        for key in (
            "before_mean_ndvi", "after_mean_ndvi",
            "before_mean_ndwi", "after_mean_ndwi",
            "before_mean_ndbi", "after_mean_ndbi",
        ):
            if not -1 <= numeric_fields[key] <= 1:
                return {
                    "success": False,
                    "error": f"{key} must be between -1 and 1."
                }

        for key in (
            "before_vegetation_percentage",
            "after_vegetation_percentage",
            "before_water_percentage",
            "after_water_percentage",
            "before_builtup_percentage",
            "after_builtup_percentage",
        ):
            if not 0 <= numeric_fields[key] <= 100:
                return {
                    "success": False,
                    "error": f"{key} must be between 0 and 100."
                }

        summary = (change_summary or "").strip()

        prompt = f"""
You are the satellite-analysis intelligence layer of SatQuery-AI.

Interpret ONLY the measured multispectral evidence below.

BEFORE:
NDVI mean: {numeric_fields["before_mean_ndvi"]:.4f}
Vegetation indicator: {numeric_fields["before_vegetation_percentage"]:.2f}%
NDWI mean: {numeric_fields["before_mean_ndwi"]:.4f}
Water indicator: {numeric_fields["before_water_percentage"]:.2f}%
NDBI mean: {numeric_fields["before_mean_ndbi"]:.4f}
Built-up indicator: {numeric_fields["before_builtup_percentage"]:.2f}%

AFTER:
NDVI mean: {numeric_fields["after_mean_ndvi"]:.4f}
Vegetation indicator: {numeric_fields["after_vegetation_percentage"]:.2f}%
NDWI mean: {numeric_fields["after_mean_ndwi"]:.4f}
Water indicator: {numeric_fields["after_water_percentage"]:.2f}%
NDBI mean: {numeric_fields["after_mean_ndbi"]:.4f}
Built-up indicator: {numeric_fields["after_builtup_percentage"]:.2f}%

Computed change summary:
{summary or "Not supplied"}

Rules:
- Do not invent a location, cause, date, object, or event.
- Treat the percentage indicators as independent threshold-based measurements.
- Do not claim they form a mutually exclusive 100% land-cover composition.
- Distinguish measured change from possible interpretation.
- Keep the response concise and evidence-based.

Return exactly these sections:
Overall Change
Vegetation
Water
Built-up
Short Conclusion
"""

        if not HF_TOKEN:
            insight = (
                f"Overall Change: {summary or 'Multispectral comparison completed.'}\n"
                f"Vegetation: NDVI {numeric_fields['before_mean_ndvi']:.4f} → "
                f"{numeric_fields['after_mean_ndvi']:.4f}; vegetation indicator "
                f"{numeric_fields['before_vegetation_percentage']:.2f}% → "
                f"{numeric_fields['after_vegetation_percentage']:.2f}%.\n"
                f"Water: NDWI {numeric_fields['before_mean_ndwi']:.4f} → "
                f"{numeric_fields['after_mean_ndwi']:.4f}; water indicator "
                f"{numeric_fields['before_water_percentage']:.2f}% → "
                f"{numeric_fields['after_water_percentage']:.2f}%.\n"
                f"Built-up: NDBI {numeric_fields['before_mean_ndbi']:.4f} → "
                f"{numeric_fields['after_mean_ndbi']:.4f}; built-up indicator "
                f"{numeric_fields['before_builtup_percentage']:.2f}% → "
                f"{numeric_fields['after_builtup_percentage']:.2f}%.\n"
                "Short Conclusion: Review the measured index changes together; "
                "the percentages are independent indicators."
            )
            return {
                "success": True,
                "mode": "demo",
                "provider": "fallback",
                "module": "Multispectral Change AI Insight",
                "phase": "7",
                "insight": insight,
            }

        headers = {
            "Authorization": f"Bearer {HF_TOKEN}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        payload = {
            "model": HF_MODEL,
            "messages": [
                {
                    "role": "user",
                    "content": prompt,
                }
            ],
            "max_tokens": 700,
        }

        response = requests.post(
            HF_URL,
            headers=headers,
            json=payload,
            timeout=120,
        )

        if response.status_code != 200:
            try:
                details = response.json()
            except Exception:
                details = response.text[:1500]

            return {
                "success": False,
                "error": f"AI provider request failed: {response.status_code}",
                "details": details,
            }

        data = response.json()
        choices = data.get("choices") or []

        if not choices:
            return {
                "success": False,
                "error": "AI provider returned no choices.",
            }

        message = choices[0].get("message") or {}
        insight = (
            message.get("content")
            or message.get("reasoning_content")
            or ""
        ).strip()

        if not insight:
            return {
                "success": False,
                "error": "AI provider returned an empty insight.",
            }

        return {
            "success": True,
            "mode": "live",
            "provider": "Hugging Face",
            "model": HF_MODEL,
            "module": "Multispectral Change AI Insight",
            "phase": "7",
            "insight": insight,
        }

    except ValueError as exc:
        return {
            "success": False,
            "error": str(exc),
        }
    except requests.RequestException as exc:
        return {
            "success": False,
            "error": "Unable to connect to the AI provider.",
            "details": str(exc),
        }
    except Exception as exc:
        print("MULTISPECTRAL AI ERROR:", str(exc))
        return {
            "success": False,
            "error": "Unexpected multispectral AI error.",
            "details": str(exc),
        }

# ============================================================


# ============================================================
# PHASE 8A — MULTI-TEMPORAL SENTINEL-2 SCENE RETRIEVAL
# ============================================================

@app.post("/api/multi-temporal-scenes")
async def multi_temporal_scenes(
    west: float = Form(...),
    south: float = Form(...),
    east: float = Form(...),
    north: float = Form(...),
    start_year: int = Form(...),
    end_year: int = Form(...),
    target_month: int = Form(6),
    target_day: int = Form(15),
    window_days: int = Form(180),
    max_cloud_cover: float = Form(100),
):
    """
    Phase 8A only:
    Retrieve one representative Sentinel-2 L2A scene per year
    for the same requested AOI.

    This stage returns metadata only. No NDVI/NDWI/NDBI
    temporal processing is performed here.
    """
    global CDSE_ACCESS_TOKEN
    global CDSE_TOKEN_EXPIRES_AT

    from datetime import date, datetime, timedelta

    # --------------------------------------------------------
    # VALIDATE INPUT
    # --------------------------------------------------------

    try:
        west = float(west)
        south = float(south)
        east = float(east)
        north = float(north)

        start_year = int(start_year)
        end_year = int(end_year)

        target_month = int(target_month)
        target_day = int(target_day)

        window_days = int(window_days)
        max_cloud_cover = float(max_cloud_cover)

    except (TypeError, ValueError):
        return {
            "success": False,
            "error": "Invalid Phase 8A parameters.",
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

    if start_year < 2015 or end_year < 2015:
        return {
            "success": False,
            "error": "Sentinel-2 analysis requires year 2015 or later.",
        }

    if start_year > end_year:
        return {
            "success": False,
            "error": "Start year cannot be later than end year.",
        }

    if end_year - start_year > 10:
        return {
            "success": False,
            "error": "Maximum temporal range is 10 years.",
        }

    if not 1 <= target_month <= 12:
        return {
            "success": False,
            "error": "Target month must be between 1 and 12.",
        }

    if not 1 <= target_day <= 31:
        return {
            "success": False,
            "error": "Target day must be between 1 and 31.",
        }

    if not 0 <= window_days <= 180:
        return {
            "success": False,
            "error": "Search window must be between 0 and 180 days.",
        }

    if not 0 <= max_cloud_cover <= 100:
        return {
            "success": False,
            "error": "Cloud cover must be between 0 and 100.",
        }

    # Validate the month/day combination using a non-leap year.
    try:
        date(2021, target_month, target_day)
    except ValueError:
        return {
            "success": False,
            "error": "Invalid target month/day combination.",
        }

    # --------------------------------------------------------
    # AUTHENTICATION
    # --------------------------------------------------------

    try:
        access_token = get_cdse_access_token()

    except Exception as exc:
        print("PHASE 8A AUTH ERROR:", str(exc))

        return {
            "success": False,
            "error": (
                "Unable to authenticate with "
                "Copernicus Data Space."
            ),
            "details": str(exc),
        }

    # Keep this request deliberately simple.
    # The official Sentinel Hub Catalog POST example uses:
    # bbox + datetime + collections + limit.
    # We apply the cloud threshold locally after retrieval.
    #
    # This avoids the previous Phase 8A request-format problem
    # and makes the first Phase 8A test independent of optional
    # Catalog filtering extensions.

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    scenes_by_year = []
    missing_years = []
    errors = []

    # --------------------------------------------------------
    # SEARCH YEARS IN PARALLEL
    # --------------------------------------------------------
    #
    # The previous implementation queried 5 years sequentially.
    # If the CDSE service takes ~20-30 seconds for one request,
    # the UI could appear stuck for 2+ minutes.  Phase 8A only
    # needs metadata, so run the independent yearly searches in
    # parallel and keep each request bounded by a short timeout.

    from concurrent.futures import ThreadPoolExecutor, as_completed

    def search_one_year(year):
        """Search and select one representative scene for one year."""

        # February 29 is only valid in leap years.
        if target_month == 2 and target_day == 29:
            if year % 4 == 0 and (
                year % 100 != 0 or year % 400 == 0
            ):
                center = date(year, 2, 29)
            else:
                center = date(year, 2, 28)
        else:
            try:
                center = date(year, target_month, target_day)
            except ValueError:
                center = date(year, target_month, 28)

        year_start = max(
            date(year, 1, 1),
            center - timedelta(days=window_days),
        )
        year_end = min(
            date(year, 12, 31),
            center + timedelta(days=window_days),
        )

        payload = {
            "collections": ["sentinel-2-l2a"],
            "datetime": (
                f"{year_start.isoformat()}T00:00:00Z/"
                f"{year_end.isoformat()}T23:59:59Z"
            ),
            "bbox": [west, south, east, north],
            "limit": 10,
            "fields": {
                "exclude": ["assets", "links", "geometry"],
            },
        }

        try:
            response = requests.post(
                CDSE_CATALOG_URL,
                headers=headers,
                json=payload,
                timeout=15,
            )

            print(
                "PHASE 8A CATALOG STATUS:",
                year,
                response.status_code,
            )

            # Retry once if the cached OAuth token expired.
            if response.status_code == 401:
                global CDSE_ACCESS_TOKEN
                global CDSE_TOKEN_EXPIRES_AT

                CDSE_ACCESS_TOKEN = None
                CDSE_TOKEN_EXPIRES_AT = 0

                refreshed_token = get_cdse_access_token()
                retry_headers = dict(headers)
                retry_headers["Authorization"] = (
                    f"Bearer {refreshed_token}"
                )

                response = requests.post(
                    CDSE_CATALOG_URL,
                    headers=retry_headers,
                    json=payload,
                    timeout=15,
                )

                print(
                    "PHASE 8A CATALOG RETRY STATUS:",
                    year,
                    response.status_code,
                )

            if response.status_code != 200:
                try:
                    details = response.json()
                except Exception:
                    details = response.text[:1000]

                return {
                    "year": year,
                    "scene": None,
                    "error": {
                        "year": year,
                        "status_code": response.status_code,
                        "details": details,
                    },
                }

            try:
                data = response.json()
            except ValueError as exc:
                return {
                    "year": year,
                    "scene": None,
                    "error": {
                        "year": year,
                        "status_code": response.status_code,
                        "details": (
                            "Invalid JSON returned by Catalog: "
                            + str(exc)
                        ),
                    },
                }

            features = data.get("features") or []
            candidates = []

            for item in features:
                try:
                    scene = format_satellite_scene(item)

                    try:
                        cloud = float(
                            scene.get("cloud_cover")
                        )
                    except (TypeError, ValueError):
                        cloud = 999.0

                    if cloud > max_cloud_cover:
                        continue

                    acquisition = (
                        scene.get("acquisition_date") or ""
                    )

                    try:
                        acquisition_date = datetime.fromisoformat(
                            acquisition.replace("Z", "+00:00")
                        ).date()
                        day_distance = abs(
                            (acquisition_date - center).days
                        )
                    except Exception:
                        day_distance = 999999

                    candidates.append({
                        "cloud": cloud,
                        "day_distance": day_distance,
                        "acquisition": acquisition,
                        "scene": scene,
                    })

                except Exception as exc:
                    print(
                        "PHASE 8A SCENE FORMAT ERROR:",
                        year,
                        str(exc),
                    )

            if not candidates:
                return {
                    "year": year,
                    "scene": None,
                    "error": None,
                }

            candidates.sort(
                key=lambda item: (
                    item["cloud"],
                    item["day_distance"],
                    item["acquisition"],
                )
            )

            selected = candidates[0]["scene"]
            selected["analysis_year"] = year
            selected["target_date"] = center.isoformat()
            selected["search_start"] = year_start.isoformat()
            selected["search_end"] = year_end.isoformat()

            return {
                "year": year,
                "scene": selected,
                "error": None,
            }

        except requests.RequestException as exc:
            print(
                "PHASE 8A REQUEST ERROR:",
                year,
                str(exc),
            )
            return {
                "year": year,
                "scene": None,
                "error": {
                    "year": year,
                    "status_code": None,
                    "details": str(exc),
                },
            }

        except Exception as exc:
            print(
                "PHASE 8A UNEXPECTED ERROR:",
                year,
                str(exc),
            )
            return {
                "year": year,
                "scene": None,
                "error": {
                    "year": year,
                    "status_code": None,
                    "details": str(exc),
                },
            }

    requested_years = list(range(start_year, end_year + 1))
    yearly_results = []

    with ThreadPoolExecutor(
        max_workers=min(5, len(requested_years))
    ) as executor:
        futures = [
            executor.submit(search_one_year, year)
            for year in requested_years
        ]

        for future in as_completed(futures):
            yearly_results.append(future.result())

    yearly_results.sort(key=lambda item: item["year"])

    for result in yearly_results:
        year = result["year"]
        scene = result.get("scene")
        error = result.get("error")

        if scene is not None:
            scenes_by_year.append(scene)
        else:
            missing_years.append(year)

        if error is not None:
            errors.append(error)

    # --------------------------------------------------------
    # SORT RESULTS
    # --------------------------------------------------------

    scenes_by_year.sort(
        key=lambda scene: (
            scene.get(
                "analysis_year"
            )
            or 0
        )
    )

    # --------------------------------------------------------
    # RESPONSE
    # --------------------------------------------------------

    return {

        "success": True,

        "module":
            "Multi-Temporal Scene Retrieval",

        "phase":
            "8A",

        "collection":
            "sentinel-2-l2a",

        "requested_years":
            list(
                range(
                    start_year,
                    end_year + 1,
                )
            ),

        "retrieved_years":
            [
                scene[
                    "analysis_year"
                ]
                for scene
                in scenes_by_year
            ],

        "missing_years":
            missing_years,

        "count":
            len(
                scenes_by_year
            ),

        "same_aoi":
            True,

        "query": {

            "bbox": [
                west,
                south,
                east,
                north,
            ],

            "start_year":
                start_year,

            "end_year":
                end_year,

            "target_month":
                target_month,

            "target_day":
                target_day,

            "window_days":
                window_days,

            "max_cloud_cover":
                max_cloud_cover,
        },

        "selection_rule": (
            "One scene per year: lowest "
            "cloud cover, then closest "
            "acquisition date to the "
            "target date."
        ),

        "scenes":
            scenes_by_year,

        "errors":
            errors,

        "note": (
            "Phase 8A retrieves "
            "Sentinel-2 scene metadata "
            "only. NDVI, NDWI, NDBI "
            "and temporal trend "
            "calculations are added "
            "in later Phase 8 stages."
        ),
    }



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
# PHASE 8 — UNIFIED MULTI-TEMPORAL SPECTRAL ANALYSIS
# ============================================================

@app.post("/api/multi-temporal-indices")
async def multi_temporal_indices(
    west: float = Form(...),
    south: float = Form(...),
    east: float = Form(...),
    north: float = Form(...),
    scenes_json: str = Form(...),
    indices_json: str = Form(...),
):
    """
    Unified Phase 8 temporal analysis.

    The user selects any combination of NDVI, NDWI and NDBI. Only the
    selected indices are calculated. One Process API request is made per
    temporal scene, with requests processed concurrently in a small pool.

    AOI coverage is checked automatically here; there is no separate
    user-facing AOI validation step.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    def normalize_bbox(value):
        try:
            values = [float(item) for item in value]
        except (TypeError, ValueError):
            return None
        if len(values) != 4:
            return None
        west_v, south_v, east_v, north_v = values
        if not (-180 <= west_v <= 180 and -180 <= east_v <= 180 and -90 <= south_v <= 90 and -90 <= north_v <= 90):
            return None
        if west_v >= east_v or south_v >= north_v:
            return None
        return [west_v, south_v, east_v, north_v]

    try:
        aoi = normalize_bbox([west, south, east, north])
        if not aoi:
            return {"success": False, "error": "Invalid AOI coordinates."}
        scenes = json.loads(scenes_json)
        indices = json.loads(indices_json)
    except (TypeError, ValueError, json.JSONDecodeError):
        return {"success": False, "error": "Invalid scenes or index selection JSON."}

    if not isinstance(scenes, list) or not scenes:
        return {"success": False, "error": "Retrieve multi-year scenes first."}
    if len(scenes) > 10:
        return {"success": False, "error": "Maximum of 10 temporal scenes is supported."}

    allowed = {"NDVI", "NDWI", "NDBI"}
    if not isinstance(indices, list):
        return {"success": False, "error": "Index selection must be a list."}
    selected = [item for item in ["NDVI", "NDWI", "NDBI"] if item in indices and item in allowed]
    if not selected:
        return {"success": False, "error": "Select at least one index: NDVI, NDWI or NDBI."}

    # Automatic AOI coverage validation.
    invalid_years = []
    validation = []
    for scene in scenes:
        year = scene.get("analysis_year") if isinstance(scene, dict) else None
        scene_bbox = normalize_bbox(scene.get("bbox")) if isinstance(scene, dict) else None
        valid = bool(
            scene_bbox
            and scene_bbox[0] <= aoi[0]
            and scene_bbox[1] <= aoi[1]
            and scene_bbox[2] >= aoi[2]
            and scene_bbox[3] >= aoi[3]
        )
        validation.append({"year": year, "valid": valid})
        if not valid and year is not None:
            invalid_years.append(int(year))

    if invalid_years:
        return {
            "success": False,
            "error": "One or more retrieved scenes do not fully cover the selected AOI.",
            "aoi_validation": {
                "same_aoi": False,
                "valid_years": [item["year"] for item in validation if item["valid"]],
                "invalid_years": invalid_years,
                "results": validation,
            },
        }

    try:
        access_token = get_cdse_access_token()
    except Exception as exc:
        print("PHASE 8 UNIFIED AUTH ERROR:", str(exc))
        return {
            "success": False,
            "error": "Unable to authenticate with Copernicus Data Space.",
            "details": str(exc),
        }

    # Build only the spectral inputs and output bands needed by the user.
    needed_bands = ["B08"]
    if "NDVI" in selected:
        needed_bands.append("B04")
    if "NDWI" in selected:
        needed_bands.append("B03")
    if "NDBI" in selected:
        needed_bands.append("B11")
    needed_bands.append("SCL")

    input_literal = ", ".join(f'"{band}"' for band in needed_bands)
    output_count = len(selected)

    eval_lines = [
        "//VERSION=3",
        "function setup() {",
        "  return {",
        f"    input: [{input_literal}],",
        f"    output: {{ bands: {output_count}, sampleType: \"FLOAT32\" }}",
        "  };",
        "}",
        "function evaluatePixel(sample) {",
        "  if (sample.SCL === 3 || sample.SCL === 8 || sample.SCL === 9 || sample.SCL === 10 || sample.SCL === 11) {",
        f"    return [{', '.join(['-9999'] * output_count)}];",
        "  }",
    ]

    for index in selected:
        if index == "NDVI":
            eval_lines.append("  var ndvi = (sample.B08 + sample.B04) === 0 ? -9999 : (sample.B08 - sample.B04) / (sample.B08 + sample.B04);")
        elif index == "NDWI":
            eval_lines.append("  var ndwi = (sample.B03 + sample.B08) === 0 ? -9999 : (sample.B03 - sample.B08) / (sample.B03 + sample.B08);")
        elif index == "NDBI":
            eval_lines.append("  var ndbi = (sample.B11 + sample.B08) === 0 ? -9999 : (sample.B11 - sample.B08) / (sample.B11 + sample.B08);")

    eval_lines.append(f"  return [{', '.join(index.lower() for index in selected)}];")
    eval_lines.extend(["}", ""])
    evalscript = "\n".join(eval_lines)

    ordered_scenes = sorted(
        scenes,
        key=lambda item: int(item.get("analysis_year") or 0),
    )

    def process_scene(scene):
        year = int(scene.get("analysis_year"))
        date_only = str(scene.get("acquisition_date") or scene.get("date") or "")[:10]
        if not date_only:
            return None, year, "Missing acquisition date."

        request_body = {
            "input": {
                "bounds": {
                    "bbox": aoi,
                    "properties": {"crs": "http://www.opengis.net/def/crs/OGC/1.3/CRS84"},
                },
                "data": [{
                    "type": "sentinel-2-l2a",
                    "dataFilter": {
                        "timeRange": {
                            "from": f"{date_only}T00:00:00Z",
                            "to": f"{date_only}T23:59:59Z",
                        },
                        "mosaickingOrder": "leastCC",
                    },
                }],
            },
            "output": {
                "width": 512,
                "height": 512,
                "responses": [{"identifier": "default", "format": {"type": "image/tiff"}}],
            },
            "evalscript": evalscript,
        }

        try:
            response = None
            for attempt in range(3):
                headers = {
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json",
                    "Accept": "image/tiff",
                }
                response = requests.post(
                    CDSE_PROCESS_URL,
                    headers=headers,
                    json=request_body,
                    timeout=120,
                )
                print("PHASE 8 UNIFIED STATUS:", year, "attempt", attempt + 1, response.status_code)

                if response.status_code == 401:
                    try:
                        refreshed_token = get_cdse_access_token()
                        headers["Authorization"] = f"Bearer {refreshed_token}"
                        response = requests.post(
                            CDSE_PROCESS_URL,
                            headers=headers,
                            json=request_body,
                            timeout=120,
                        )
                        print("PHASE 8 UNIFIED TOKEN-RETRY STATUS:", year, response.status_code)
                    except Exception as token_exc:
                        return None, year, f"Token refresh failed: {token_exc}"

                if response.status_code == 200 and response.content:
                    break

                if response.status_code in (429, 500, 502, 503, 504):
                    import time
                    time.sleep(1.5 * (attempt + 1))
                    continue
                break

            if response is None:
                return None, year, "No Process API response."
            if response.status_code != 200 or not response.content:
                try:
                    preview = response.text[:400]
                except Exception:
                    preview = ""
                return None, year, f"Process API HTTP {response.status_code}: {preview}"

            raw = response.content
            content_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
            tiff_magic = raw[:4] in (b"II*\x00", b"MM\x00*")
            if not (content_type.startswith("image/") or tiff_magic):
                try:
                    preview = response.text[:400]
                except Exception:
                    preview = "<unable to decode response body>"
                return None, year, f"Process API returned {content_type or 'unknown'}: {preview}"

            # CDSE Process API returns a GeoTIFF. Some valid FLOAT32/GeoTIFF
            # responses cannot be decoded by Pillow, so use TIFF-aware decoders
            # first and keep Pillow only as a fallback.
            array = None
            decode_errors = []

            if rasterio is not None:
                try:
                    with rasterio.io.MemoryFile(raw) as memfile:
                        with memfile.open() as dataset:
                            array = dataset.read().astype(np.float32)
                            # rasterio returns (bands, height, width); convert to
                            # the frontend/statistics convention (height, width, bands).
                            if array.ndim == 3:
                                array = np.moveaxis(array, 0, -1)
                except Exception as image_exc:
                    decode_errors.append(f"rasterio: {image_exc}")

            if array is None and tifffile is not None:
                try:
                    array = np.asarray(tifffile.imread(io.BytesIO(raw)), dtype=np.float32)
                    if array.ndim == 3 and array.shape[0] == output_count and array.shape[-1] != output_count:
                        array = np.moveaxis(array, 0, -1)
                except Exception as image_exc:
                    decode_errors.append(f"tifffile: {image_exc}")

            if array is None:
                try:
                    with Image.open(io.BytesIO(raw)) as image:
                        array = np.array(image, dtype=np.float32)
                        if array.ndim == 2:
                            array = array[:, :, np.newaxis]
                except Exception as image_exc:
                    decode_errors.append(f"Pillow: {image_exc}")

            if array is None:
                return None, year, (
                    "Unable to decode Process API image. "
                    + " | ".join(decode_errors)
                )

            if output_count == 1 and array.ndim == 2:
                array = array[:, :, np.newaxis]
            if array.ndim != 3 or array.shape[-1] < output_count:
                return None, year, f"Expected {output_count}-band output, received shape {array.shape}"

            row = {
                "analysis_year": year,
                "date": date_only,
                "scene_id": scene.get("id"),
            }

            def metric_stats(values):
                valid = np.isfinite(values) & (values > -1.0) & (values <= 1.0)
                vals = values[valid]
                if vals.size == 0:
                    return None
                return {
                    "mean": round(float(np.mean(vals)), 4),
                    "min": round(float(np.min(vals)), 4),
                    "max": round(float(np.max(vals)), 4),
                    "percentage": round(float(np.mean(vals > 0.20) * 100.0), 2),
                    "valid_pixels": int(vals.size),
                }

            for band_index, index in enumerate(selected):
                stats = metric_stats(array[:, :, band_index])
                if stats is None:
                    continue
                if index == "NDVI":
                    row["ndvi"] = {
                        **stats,
                        "health": (
                            "Excellent" if stats["mean"] >= 0.60 else
                            "Healthy" if stats["mean"] >= 0.40 else
                            "Moderate" if stats["mean"] >= 0.20 else
                            "Sparse" if stats["mean"] >= 0.00 else "Very Low"
                        ),
                    }
                elif index == "NDWI":
                    row["ndwi"] = {
                        **stats,
                        "status": (
                            "High Water Presence" if stats["mean"] >= 0.40 else
                            "Moderate Water Presence" if stats["mean"] >= 0.20 else
                            "Low Water Presence" if stats["mean"] >= 0.00 else
                            "Very Low Water Presence"
                        ),
                    }
                elif index == "NDBI":
                    row["ndbi"] = {
                        **stats,
                        "status": (
                            "Very High Built-up Intensity" if stats["mean"] >= 0.40 else
                            "High Built-up Intensity" if stats["mean"] >= 0.20 else
                            "Moderate Built-up Intensity" if stats["mean"] >= 0.00 else
                            "Low Built-up Intensity"
                        ),
                    }

            return (row if any(key in row for key in ("ndvi", "ndwi", "ndbi")) else None), year, None

        except requests.RequestException as exc:
            print("PHASE 8 UNIFIED REQUEST ERROR:", year, str(exc))
            return None, year, str(exc)
        except Exception as exc:
            print("PHASE 8 UNIFIED ERROR:", year, str(exc))
            return None, year, str(exc)

    results = []
    failed_years = []
    failed_details = []

    with ThreadPoolExecutor(max_workers=min(3, len(ordered_scenes))) as executor:
        futures = [executor.submit(process_scene, scene) for scene in ordered_scenes]
        for future in as_completed(futures):
            row, failed_year, detail = future.result()
            if row is not None:
                results.append(row)
            if failed_year is not None and row is None:
                failed_years.append(failed_year)
                failed_details.append({"year": failed_year, "error": detail or "Unknown processing error."})

    results.sort(key=lambda item: item["analysis_year"])
    return {
        "success": bool(results),
        "module": "Unified Multi-Temporal Spectral Analysis",
        "phase": "8C-8D-8E",
        "product": "Sentinel-2 L2A",
        "selected_indices": selected,
        "same_aoi": True,
        "aoi_validation": {
            "same_aoi": True,
            "valid_years": [item["year"] for item in validation if item["valid"]],
            "invalid_years": [],
            "results": validation,
        },
        "requested_scene_count": len(scenes),
        "processed_scene_count": len(results),
        "failed_years": sorted(failed_years),
        "failed_details": failed_details,
        "results": results,
        "note": "Only user-selected indices were calculated. AOI coverage was validated automatically before processing.",
    }


# ============================================================
# PHASE 6D — DETERMINISTIC COMBINED LAND INTELLIGENCE
# HF TOKEN NOT REQUIRED
# ============================================================

@app.post("/api/combined-land-ai-insight")
async def combined_land_ai_insight(
    mean_ndvi: float = Form(...),
    vegetation_percentage: float = Form(...),
    mean_ndwi: float = Form(...),
    water_percentage: float = Form(...),
    mean_ndbi: float = Form(...),
    builtup_percentage: float = Form(...),
    dominant_type: str = Form(...),
    dominant_percentage: float = Form(...),
    classification: str = Form(...),
    classified_total_percentage: float = Form(...),
    other_percentage: float = Form(...),
    overlap_detected: bool = Form(...),
):
    """
    Token-free Phase 6D satellite intelligence.

    Uses the NDVI, NDWI and NDBI measurements already calculated
    by SatQuery-AI. No Hugging Face request is made here.
    """

    # Keep the endpoint deterministic and evidence-based.
    mean_ndvi = float(mean_ndvi)
    vegetation_percentage = float(vegetation_percentage)
    mean_ndwi = float(mean_ndwi)
    water_percentage = float(water_percentage)
    mean_ndbi = float(mean_ndbi)
    builtup_percentage = float(builtup_percentage)
    dominant_percentage = float(dominant_percentage)
    classified_total_percentage = float(classified_total_percentage)
    other_percentage = float(other_percentage)

    # --------------------------------------------------------
    # Indicator interpretation
    # --------------------------------------------------------

    if mean_ndvi >= 0.60:
        vegetation_status = "High vegetation signal"
    elif mean_ndvi >= 0.40:
        vegetation_status = "Moderate vegetation signal"
    elif mean_ndvi >= 0.20:
        vegetation_status = "Low-to-moderate vegetation signal"
    elif mean_ndvi >= 0.00:
        vegetation_status = "Low vegetation signal"
    else:
        vegetation_status = "Very low vegetation signal"

    if mean_ndwi >= 0.40:
        water_status = "High water-related signal"
    elif mean_ndwi >= 0.20:
        water_status = "Moderate water-related signal"
    elif mean_ndwi >= 0.00:
        water_status = "Low-to-moderate water-related signal"
    else:
        water_status = "Low water-related signal"

    if mean_ndbi >= 0.40:
        builtup_status = "Very high built-up signal"
    elif mean_ndbi >= 0.20:
        builtup_status = "High built-up signal"
    elif mean_ndbi >= 0.00:
        builtup_status = "Moderate built-up signal"
    else:
        builtup_status = "Low built-up signal"

    # --------------------------------------------------------
    # Evidence-based text
    # --------------------------------------------------------

    overall_land_condition = (
        f"{classification}. "
        f"{dominant_type} is the dominant measured indicator "
        f"at {dominant_percentage:.2f}%."
    )

    vegetation_insight = (
        f"Mean NDVI is {mean_ndvi:.4f}, with a vegetation "
        f"indicator of {vegetation_percentage:.2f}%. "
        f"{vegetation_status}."
    )

    water_insight = (
        f"Mean NDWI is {mean_ndwi:.4f}, with a water "
        f"indicator of {water_percentage:.2f}%. "
        f"{water_status}."
    )

    builtup_insight = (
        f"Mean NDBI is {mean_ndbi:.4f}, with a built-up "
        f"indicator of {builtup_percentage:.2f}%. "
        f"{builtup_status}."
    )

    if overlap_detected:
        composition_note = (
            "The vegetation, water and built-up percentages are "
            "independent threshold-based indicators and may overlap; "
            "they are not mutually exclusive land-cover classes."
        )
    else:
        composition_note = (
            "The vegetation, water and built-up percentages are "
            "independent threshold-based indicators."
        )

    short_conclusion = (
        f"{classification}. The measured NDVI, NDWI and NDBI "
        f"indicators should be interpreted together as evidence "
        f"from the selected satellite scene."
    )

    insight = (
        f"Overall Land Condition: {overall_land_condition}\n\n"
        f"Vegetation: {vegetation_insight}\n\n"
        f"Water: {water_insight}\n\n"
        f"Built-up: {builtup_insight}\n\n"
        f"Short Conclusion: {short_conclusion}\n\n"
        f"Data Note: {composition_note}"
    )

    return {
        "success": True,
        "mode": "deterministic",
        "provider": "local-evidence",
        "module": "Combined Land AI Insight",
        "phase": "6D",

        # Main human-readable fields.
        "overall_land_condition": overall_land_condition,
        "vegetation": vegetation_insight,
        "water": water_insight,
        "built_up": builtup_insight,
        "builtup": builtup_insight,
        "short_conclusion": short_conclusion,
        "insight": insight,

        # Structured evidence.
        "measurements": {
            "mean_ndvi": round(mean_ndvi, 4),
            "vegetation_percentage": round(vegetation_percentage, 2),
            "mean_ndwi": round(mean_ndwi, 4),
            "water_percentage": round(water_percentage, 2),
            "mean_ndbi": round(mean_ndbi, 4),
            "builtup_percentage": round(builtup_percentage, 2),
        },

        "classification": classification,
        "dominant_type": dominant_type,
        "dominant_percentage": round(dominant_percentage, 2),

        "combined_statistics": {
            "vegetation_percentage": round(
                vegetation_percentage, 2
            ),
            "water_percentage": round(
                water_percentage, 2
            ),
            "builtup_percentage": round(
                builtup_percentage, 2
            ),
            "classified_total_percentage": round(
                classified_total_percentage, 2
            ),
            "other_percentage": round(
                other_percentage, 2
            ),
            "overlap_detected": overlap_detected,
        },

        "data_note": composition_note,
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

