const API_BASE = "https://satquery-ai-backend-r165.onrender.com";

/* =========================================================
   AI IMAGE / VQA ANALYSIS
   ========================================================= */

export async function askVQA({ file, question }) {
  if (!file) {
    throw new Error("Please select a satellite image.");
  }

  if (!question?.trim()) {
    throw new Error("Please enter a question.");
  }

  const formData = new FormData();

  formData.append("image", file, file.name);
  formData.append("question", question.trim());

  const response = await fetch(`${API_BASE}/api/vqa`, {
    method: "POST",
    body: formData,
  });

  let data = null;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      `Backend returned HTTP ${response.status}.`
    );
  }

  if (!response.ok || data?.success === false) {
    throw new Error(
      data?.error ||
        data?.message ||
        `AI API error: ${response.status}`
    );
  }

  return data;
}


/* =========================================================
   NDVI ANALYSIS
   Sentinel-2:
   B04 = Red
   B08 = NIR
   Formula = (NIR - Red) / (NIR + Red)
   ========================================================= */

export async function analyzeNDVI({ scene, areaBounds }) {
  if (!scene) {
    throw new Error("No Sentinel-2 scene selected.");
  }

  if (
    !areaBounds ||
    !Array.isArray(areaBounds) ||
    areaBounds.length !== 2
  ) {
    throw new Error("No valid AOI bounds found.");
  }

  const acquisitionDate =
    scene.acquisition_date ||
    scene.acquisitionDate ||
    scene.properties?.datetime ||
    "";

  if (!acquisitionDate) {
    throw new Error(
      "Selected Sentinel-2 scene does not have an acquisition date."
    );
  }

  /*
    areaBounds format:

    [
      [south, west],
      [north, east]
    ]
  */

  const west = areaBounds[0][1];
  const south = areaBounds[0][0];
  const east = areaBounds[1][1];
  const north = areaBounds[1][0];

  const formData = new FormData();

  formData.append("west", String(west));
  formData.append("south", String(south));
  formData.append("east", String(east));
  formData.append("north", String(north));
  formData.append(
    "acquisition_date",
    acquisitionDate
  );

  const response = await fetch(
    `${API_BASE}/api/satellite-ndvi`,
    {
      method: "POST",
      body: formData,
    }
  );

  let data = null;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      `NDVI backend returned HTTP ${response.status}.`
    );
  }

  if (!response.ok || data?.success === false) {
    throw new Error(
      data?.error ||
        data?.message ||
        `NDVI API error: ${response.status}`
    );
  }

  return data;
}


/* =========================================================
   NDWI ANALYSIS
   Sentinel-2:
   B03 = Green
   B08 = NIR
   Formula = (Green - NIR) / (Green + NIR)
   ========================================================= */

export async function analyzeNDWI({ scene, areaBounds }) {
  if (!scene) {
    throw new Error("No Sentinel-2 scene selected.");
  }

  if (
    !areaBounds ||
    !Array.isArray(areaBounds) ||
    areaBounds.length !== 2
  ) {
    throw new Error(
      "Valid AOI bounds are required for NDWI."
    );
  }

  const acquisitionDate =
    scene.acquisition_date ||
    scene.acquisitionDate ||
    scene.properties?.datetime ||
    "";

  if (!acquisitionDate) {
    throw new Error(
      "Selected Sentinel-2 scene does not have an acquisition date."
    );
  }

  /*
    areaBounds format:

    [
      [south, west],
      [north, east]
    ]
  */

  const west = areaBounds[0][1];
  const south = areaBounds[0][0];
  const east = areaBounds[1][1];
  const north = areaBounds[1][0];

  const formData = new FormData();

  formData.append("west", String(west));
  formData.append("south", String(south));
  formData.append("east", String(east));
  formData.append("north", String(north));
  formData.append(
    "acquisition_date",
    acquisitionDate
  );

  const response = await fetch(
    `${API_BASE}/api/satellite-ndwi`,
    {
      method: "POST",
      body: formData,
    }
  );

  let data = null;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      `NDWI backend returned HTTP ${response.status}.`
    );
  }

  if (!response.ok || data?.success === false) {
    throw new Error(
      data?.error ||
        data?.message ||
        `NDWI API error: ${response.status}`
    );
  }

  return data;
}


/* =========================================================
   BACKEND HEALTH CHECK
   ========================================================= */

export async function checkHealth() {
  const response = await fetch(
    `${API_BASE}/api/health`
  );

  if (!response.ok) {
    throw new Error("Backend is not reachable.");
  }

  return response.json();
}