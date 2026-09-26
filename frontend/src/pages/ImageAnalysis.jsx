import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  askVQA,
  analyzeNDVI,
  analyzeNDWI,
  analyzeNDBI,
} from "../services/ai";

const MAX_UPLOAD = 50 * 1024 * 1024;

const ALLOWED_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".tif",
  ".tiff",
  ".jp2",
  ".j2k",
  ".nitf",
];

const DEMO_IMAGE = {
  name: "sample.png",
  path: "/demo/sample.png",
  type: "image/png",
};

function getExtension(name = "") {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function isBrowserPreviewable(file) {
  return [".png", ".jpg", ".jpeg"].includes(getExtension(file?.name));
}

export default function ImageAnalysis() {
  const navigate = useNavigate();

  const [previewUrl, setPreviewUrl] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState("");
  const [dimensions, setDimensions] = useState("");

  const [question, setQuestion] = useState(
    "Give an overall analysis of this satellite image. Identify visible land cover, vegetation, water bodies, buildings, roads, agriculture and any notable spatial patterns."
  );

  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const [activeScene, setActiveScene] = useState(null);
  const [activeAreaBounds, setActiveAreaBounds] = useState(null);

  // Phase 8A — clean multi-temporal scene retrieval
  const [multiTemporalScenes, setMultiTemporalScenes] = useState([]);
  const [multiTemporalError, setMultiTemporalError] = useState("");
  const [isMultiTemporalLoading, setIsMultiTemporalLoading] = useState(false);
  const [multiTemporalStartYear, setMultiTemporalStartYear] = useState("2022");
  const [multiTemporalEndYear, setMultiTemporalEndYear] = useState("2026");
  const [multiTemporalMonth, setMultiTemporalMonth] = useState("6");
  const [multiTemporalDay, setMultiTemporalDay] = useState("15");
  const [multiTemporalWindowDays, setMultiTemporalWindowDays] = useState("180");
  const [multiTemporalCloudCover, setMultiTemporalCloudCover] = useState("100");

  // Unified Phase 8 temporal analysis — user selects only what is needed
  const [selectedTemporalIndices, setSelectedTemporalIndices] = useState(["NDVI", "NDWI", "NDBI"]);
  const [unifiedTemporalResults, setUnifiedTemporalResults] = useState([]);
  const [unifiedTemporalError, setUnifiedTemporalError] = useState("");
  const [unifiedTemporalValidation, setUnifiedTemporalValidation] = useState(null);
  const [isUnifiedTemporalAnalyzing, setIsUnifiedTemporalAnalyzing] = useState(false);

  // NDVI
  const [ndviResult, setNdviResult] = useState(null);
  const [ndviError, setNdviError] = useState("");

  // NDWI
  const [ndwiResult, setNdwiResult] = useState(null);
  const [ndwiError, setNdwiError] = useState("");

  // NDBI
  const [ndbiResult, setNdbiResult] = useState(null);
  const [ndbiError, setNdbiError] = useState("");

  // Combined Land Intelligence (Phase 6)
  const [combinedLandResult, setCombinedLandResult] = useState(null);
  const [combinedLandError, setCombinedLandError] = useState("");
  const [isCombinedLandAnalyzing, setIsCombinedLandAnalyzing] = useState(false);
const [multispectralChangeResult, setMultispectralChangeResult] = useState(null);
const [multispectralChangeError, setMultispectralChangeError] = useState("");
const [isMultispectralChangeAnalyzing, setIsMultispectralChangeAnalyzing] = useState(false);
const [multispectralAiInsight, setMultispectralAiInsight] = useState(null);


  // =========================================================
  // PROCESS IMAGE
  // =========================================================

  const processImage = (file, options = {}) => {
    if (!file) return;

    setError("");
    setAnswer(null);

    setNdviResult(null);
    setNdviError("");

    setNdwiResult(null);
    setNdwiError("");

    setNdbiResult(null);
    setNdbiError("");

    setUnifiedTemporalResults([]);
    setUnifiedTemporalError("");
    setUnifiedTemporalValidation(null);
    setIsUnifiedTemporalAnalyzing(false);

    setCombinedLandResult(null);
    setCombinedLandError("");
      setMultispectralChangeResult(null);
      setMultispectralChangeError("");
      setMultispectralAiInsight(null);


    if (!options.keepScene) {
      setActiveScene(null);
      setActiveAreaBounds(null);
      setMultiTemporalScenes([]);
      setMultiTemporalError("");
      setIsMultiTemporalLoading(false);
      sessionStorage.removeItem("satquery_active_scene");
      sessionStorage.removeItem("satquery_multi_temporal_scenes");
    }

    const ext = getExtension(file.name);

    const typeOk =
      ALLOWED_EXTENSIONS.includes(ext) ||
      ["image/png", "image/jpeg", "image/tiff"].includes(file.type);

    if (!typeOk) {
      setError(
        "Unsupported file. Use PNG, JPG/JPEG, GeoTIFF, JP2/J2K or NITF."
      );
      return;
    }

    if (file.size > MAX_UPLOAD) {
      setError("Maximum satellite image size is 50 MB.");
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    const url = URL.createObjectURL(file);

    setPreviewUrl(url);
    setSelectedFile(file);
    setFileName(file.name);
    setFileSize(formatSize(file.size));
    setQuestion("");

    // Browser preview for PNG/JPG/JPEG
    if (isBrowserPreviewable(file)) {
      const img = new Image();

      img.onload = () => {
        setDimensions(`${img.width} × ${img.height}px`);
      };

      img.onerror = () => {
        setDimensions("Image dimensions unavailable");
      };

      img.src = url;
    } else {
      setDimensions(
        `${ext.replace(".", "").toUpperCase()} satellite image`
      );
    }
  };

  // =========================================================
  // LOAD SENTINEL-2 SCENE FROM GEOLOCATION
  // =========================================================

  useEffect(() => {
    const savedScene =
      sessionStorage.getItem("satquery_selected_scene") ||
      sessionStorage.getItem("satquery_active_scene");

    if (!savedScene) {
      return;
    }

    let cancelled = false;

    const loadSelectedScene = async () => {
      try {
        const parsed = JSON.parse(savedScene);

        if (!parsed.previewImage) {
          sessionStorage.removeItem(
            "satquery_selected_scene"
          );
          return;
        }

        const response = await fetch(parsed.previewImage);

        if (!response.ok) {
          throw new Error(
            "Selected Sentinel-2 preview could not be loaded."
          );
        }

        const blob = await response.blob();

        const file = new File(
          [blob],
          "sentinel-2-scene.jpg",
          {
            type: blob.type || "image/jpeg",
          }
        );

        if (cancelled) {
          return;
        }

        const scene = parsed.scene || null;
        const bounds = parsed.areaBounds || null;

        setActiveScene(scene);
        setActiveAreaBounds(bounds);

        processImage(file, {
          keepScene: true,
        });

        sessionStorage.setItem(
          "satquery_active_scene",
          JSON.stringify({
            scene,
            areaBounds: bounds,
          })
        );

        sessionStorage.removeItem(
          "satquery_selected_scene"
        );
      } catch (error) {
        console.error(
          "Failed to load Sentinel-2 scene:",
          error
        );

        if (!cancelled) {
          setError(
            error?.message ||
              "Unable to load the selected Sentinel-2 scene."
          );
        }
      }
    };

    loadSelectedScene();

    return () => {
      cancelled = true;
    };
  }, []);

  // =========================================================
  // PHASE 8A — MULTI-YEAR SCENE RETRIEVAL
  // =========================================================

  const retrieveMultiTemporalScenes = async () => {
    setMultiTemporalError("");
    setMultiTemporalScenes([]);
    setUnifiedTemporalResults([]);
    setUnifiedTemporalError("");
    setUnifiedTemporalValidation(null);

    if (!activeAreaBounds || !Array.isArray(activeAreaBounds) || activeAreaBounds.length < 2) {
      setMultiTemporalError("Select an Analysis Area first.");
      return;
    }

    const firstCorner = activeAreaBounds[0];
    const secondCorner = activeAreaBounds[1];

    const south = Math.min(Number(firstCorner?.[0]), Number(secondCorner?.[0]));
    const north = Math.max(Number(firstCorner?.[0]), Number(secondCorner?.[0]));
    const west = Math.min(Number(firstCorner?.[1]), Number(secondCorner?.[1]));
    const east = Math.max(Number(firstCorner?.[1]), Number(secondCorner?.[1]));

    const startYear = Number(multiTemporalStartYear);
    const endYear = Number(multiTemporalEndYear);
    const targetMonth = Number(multiTemporalMonth);
    const targetDay = Number(multiTemporalDay);
    const windowDays = Number(multiTemporalWindowDays);
    const maxCloudCover = Number(multiTemporalCloudCover);

    if (![west, south, east, north].every(Number.isFinite) || west >= east || south >= north) {
      setMultiTemporalError("The selected AOI coordinates are invalid.");
      return;
    }

    if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || startYear < 2015 || endYear < startYear || endYear - startYear > 10) {
      setMultiTemporalError("Enter a valid year range from 2015 onward (maximum 10 years).");
      return;
    }

    if (!Number.isInteger(targetMonth) || targetMonth < 1 || targetMonth > 12) {
      setMultiTemporalError("Target month must be between 1 and 12.");
      return;
    }

    if (!Number.isInteger(targetDay) || targetDay < 1 || targetDay > 31) {
      setMultiTemporalError("Target day must be between 1 and 31.");
      return;
    }

    if (!Number.isInteger(windowDays) || windowDays < 0 || windowDays > 180) {
      setMultiTemporalError("Search window must be between 0 and 180 days.");
      return;
    }

    if (!Number.isFinite(maxCloudCover) || maxCloudCover < 0 || maxCloudCover > 100) {
      setMultiTemporalError("Cloud cover must be between 0 and 100%.");
      return;
    }

    setIsMultiTemporalLoading(true);

    try {
      const apiBase = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";
      const form = new FormData();
      form.append("west", String(west));
      form.append("south", String(south));
      form.append("east", String(east));
      form.append("north", String(north));
      form.append("start_year", String(startYear));
      form.append("end_year", String(endYear));
      form.append("target_month", String(targetMonth));
      form.append("target_day", String(targetDay));
      form.append("window_days", String(windowDays));
      form.append("max_cloud_cover", String(maxCloudCover));

      const response = await fetch(`${apiBase}/api/multi-temporal-scenes`, {
        method: "POST",
        body: form,
      });

      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error("Phase 8A returned an invalid server response.");
      }

      if (!response.ok || !data?.success) {
        const details = Array.isArray(data?.errors)
          ? data.errors.map((item) => `${item?.year ?? "?"}: ${item?.details || item?.status_code || "error"}`).join(" | ")
          : "";
        throw new Error(data?.error || details || "Multi-temporal scene retrieval failed.");
      }

      const scenes = Array.isArray(data.scenes)
        ? [...data.scenes].sort((a, b) => Number(a?.analysis_year || 0) - Number(b?.analysis_year || 0))
        : [];

      setMultiTemporalScenes(scenes);

      sessionStorage.setItem(
        "satquery_multi_temporal_scenes",
        JSON.stringify({
          phase: "8A",
          aoi: [west, south, east, north],
          query: data.query,
          scenes,
          requested_years: data.requested_years || [],
          retrieved_years: data.retrieved_years || [],
          missing_years: data.missing_years || [],
        })
      );

      if (!scenes.length) {
        const missing = (data.missing_years || []).join(", ");
        setMultiTemporalError(
          missing
            ? `No Sentinel-2 scene matched for year(s): ${missing}.`
            : "No Sentinel-2 scenes matched the search criteria."
        );
      }
    } catch (err) {
      console.error("PHASE 8A MULTI-TEMPORAL RETRIEVAL ERROR:", err);
      setMultiTemporalError(err?.message || "Unable to retrieve multi-temporal Sentinel-2 scenes.");
    } finally {
      setIsMultiTemporalLoading(false);
    }
  };

  // =========================================================
  // PHASE 8 — UNIFIED NDVI / NDWI / NDBI ANALYSIS
  // =========================================================

  const analyzeSelectedTemporalIndices = async () => {
    setUnifiedTemporalError("");
    setUnifiedTemporalResults([]);
    setUnifiedTemporalValidation(null);

    if (!multiTemporalScenes.length) {
      setUnifiedTemporalError("Retrieve multi-year scenes first.");
      return;
    }

    if (!selectedTemporalIndices.length) {
      setUnifiedTemporalError("Select at least one index to analyze.");
      return;
    }

    if (!activeAreaBounds || !Array.isArray(activeAreaBounds) || activeAreaBounds.length < 2) {
      setUnifiedTemporalError("Select an Analysis Area first.");
      return;
    }

    const firstCorner = activeAreaBounds[0];
    const secondCorner = activeAreaBounds[1];
    const south = Math.min(Number(firstCorner?.[0]), Number(secondCorner?.[0]));
    const north = Math.max(Number(firstCorner?.[0]), Number(secondCorner?.[0]));
    const west = Math.min(Number(firstCorner?.[1]), Number(secondCorner?.[1]));
    const east = Math.max(Number(firstCorner?.[1]), Number(secondCorner?.[1]));

    if (![west, south, east, north].every(Number.isFinite) || west >= east || south >= north) {
      setUnifiedTemporalError("The selected AOI coordinates are invalid.");
      return;
    }

    setIsUnifiedTemporalAnalyzing(true);

    try {
      const apiBase = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";
      const form = new FormData();
      form.append("west", String(west));
      form.append("south", String(south));
      form.append("east", String(east));
      form.append("north", String(north));
      form.append("scenes_json", JSON.stringify(multiTemporalScenes));
      form.append("indices_json", JSON.stringify(selectedTemporalIndices));

      const response = await fetch(`${apiBase}/api/multi-temporal-indices`, {
        method: "POST",
        body: form,
      });

      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error("Unified temporal analysis returned an invalid server response.");
      }

      if (!response.ok || !data?.success) {
        const invalidYears = data?.aoi_validation?.invalid_years || [];
        if (invalidYears.length) {
          throw new Error(`AOI coverage check failed for year(s): ${invalidYears.join(", ")}.`);
        }
        const failedDetails = Array.isArray(data?.failed_details)
          ? data.failed_details
              .map((item) => `${item?.year ?? "?"}: ${item?.error || "processing error"}`)
              .join(" | ")
          : "";
        throw new Error(data?.error || failedDetails || "Unified multi-temporal analysis failed.");
      }

      setUnifiedTemporalResults(Array.isArray(data.results) ? data.results : []);
      setUnifiedTemporalValidation(data.aoi_validation || null);

      sessionStorage.setItem(
        "satquery_multi_temporal_analysis",
        JSON.stringify({
          phase: "8C-8D-8E",
          selected_indices: selectedTemporalIndices,
          aoi: [west, south, east, north],
          results: Array.isArray(data.results) ? data.results : [],
          aoi_validation: data.aoi_validation || null,
        })
      );

      if (!Array.isArray(data.results) || !data.results.length) {
        throw new Error("No temporal index results were returned.");
      }
    } catch (err) {
      console.error("UNIFIED MULTI-TEMPORAL ANALYSIS ERROR:", err);
      setUnifiedTemporalError(err?.message || "Unable to analyze the selected temporal indices.");
    } finally {
      setIsUnifiedTemporalAnalyzing(false);
    }
  };

  const toggleTemporalIndex = (index) => {
    setSelectedTemporalIndices((current) => {
      if (current.includes(index)) {
        return current.filter((item) => item !== index);
      }
      return [...current, index].filter((item, position, list) => list.indexOf(item) === position);
    });
    setUnifiedTemporalResults([]);
    setUnifiedTemporalError("");
  };

  // =========================================================
  // LOAD DEMO IMAGE
  // =========================================================

  const loadDemoImage = async () => {
    try {
      setError("");
      setAnswer(null);

      setNdviResult(null);
      setNdviError("");

      setNdwiResult(null);
      setNdwiError("");

      setNdbiResult(null);
      setNdbiError("");

      setCombinedLandResult(null);
      setCombinedLandError("");

      setActiveScene(null);
      setActiveAreaBounds(null);
      setMultiTemporalScenes([]);
      setMultiTemporalError("");
      setIsMultiTemporalLoading(false);
      sessionStorage.removeItem("satquery_multi_temporal_scenes");

      const response = await fetch(DEMO_IMAGE.path);

      if (!response.ok) {
        throw new Error("Demo image could not be loaded.");
      }

      const blob = await response.blob();

      const file = new File(
        [blob],
        DEMO_IMAGE.name,
        {
          type: DEMO_IMAGE.type,
        }
      );

      processImage(file);
    } catch (err) {
      setError(
        err?.message ||
          "Unable to load demo image."
      );
    }
  };

  // =========================================================
  // FILE HANDLERS
  // =========================================================

  const handleFile = (event) => {
    const file = event.target.files?.[0];

    if (file) {
      processImage(file);
    }

    event.target.value = "";
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);

    const file = event.dataTransfer.files?.[0];

    if (file) {
      processImage(file);
    }
  };

  // =========================================================
  // REMOVE IMAGE
  // =========================================================

  const removeImage = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setPreviewUrl(null);
    setSelectedFile(null);
    setFileName("");
    setFileSize("");
    setDimensions("");
    setQuestion("");
    setAnswer(null);
    setError("");

    setNdviResult(null);
    setNdviError("");

    setNdwiResult(null);
    setNdwiError("");

    setNdbiResult(null);
    setNdbiError("");

    setCombinedLandResult(null);
    setCombinedLandError("");

    setActiveScene(null);
    setActiveAreaBounds(null);
    setMultiTemporalScenes([]);
    setMultiTemporalError("");
    setIsMultiTemporalLoading(false);
    sessionStorage.removeItem("satquery_multi_temporal_scenes");
  };

  // =========================================================
  // COMBINED AI + NDVI + NDWI + NDBI ANALYSIS
  // =========================================================

  const analyzeCombinedLandIntelligence = async ({ ndvi, ndwi, ndbi }) => {
    setCombinedLandError("");
    setCombinedLandResult(null);

    const getNumber = (...values) => {
      for (const value of values) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) return numeric;
      }
      return null;
    };

    const meanNdvi = getNumber(ndvi?.stats?.mean, ndvi?.mean_ndvi, ndvi?.mean);
    const vegetationPercentage = getNumber(
      ndvi?.stats?.vegetation_percentage,
      ndvi?.vegetation_percentage,
      ndvi?.vegetation_percent
    );

    const meanNdwi = getNumber(ndwi?.stats?.mean, ndwi?.mean_ndwi, ndwi?.mean);
    const waterPercentage = getNumber(
      ndwi?.stats?.water_percentage,
      ndwi?.water_percentage,
      ndwi?.water_percent
    );

    const meanNdbi = getNumber(ndbi?.stats?.mean, ndbi?.mean_ndbi, ndbi?.mean);
    const builtupPercentage = getNumber(
      ndbi?.stats?.builtup_percentage,
      ndbi?.builtup_percentage,
      ndbi?.builtup_percent
    );

    if (
      meanNdvi === null ||
      vegetationPercentage === null ||
      meanNdwi === null ||
      waterPercentage === null ||
      meanNdbi === null ||
      builtupPercentage === null
    ) {
      setCombinedLandError(
        "Combined Land Intelligence needs valid NDVI, NDWI and NDBI statistics."
      );
      return;
    }

    setIsCombinedLandAnalyzing(true);

    try {
      const apiBase =
        import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

      // Phase 6A — Combine index statistics
      const combinedForm = new FormData();
      combinedForm.append("mean_ndvi", String(meanNdvi));
      combinedForm.append("vegetation_percentage", String(vegetationPercentage));
      combinedForm.append("mean_ndwi", String(meanNdwi));
      combinedForm.append("water_percentage", String(waterPercentage));
      combinedForm.append("mean_ndbi", String(meanNdbi));
      combinedForm.append("builtup_percentage", String(builtupPercentage));

      const combinedResponse = await fetch(
        `${apiBase}/api/combined-land-intelligence`,
        { method: "POST", body: combinedForm }
      );

      if (!combinedResponse.ok) {
        throw new Error("Combined Land Intelligence request failed.");
      }

      const combinedData = await combinedResponse.json();

      // Phase 6B — Land Characteristics
      const landValues = {
        Vegetation: vegetationPercentage,
        Water: waterPercentage,
        "Built-up": builtupPercentage,
      };

      const sorted = Object.entries(landValues).sort((a, b) => b[1] - a[1]);
      const dominantType = sorted[0][0];
      const dominantPercentage = sorted[0][1];
      const classification =
        dominantPercentage - sorted[1][1] < 10
          ? "Mixed Land Characteristics"
          : `${dominantType} Dominant`;

      // Phase 6C — Combined Statistics
      const classifiedTotalPercentage =
        vegetationPercentage + waterPercentage + builtupPercentage;
      const overlapDetected = classifiedTotalPercentage > 100;
      const otherPercentage = overlapDetected
        ? 0
        : 100 - classifiedTotalPercentage;

      // Phase 6D — Deterministic Land Insight
      // HF inference is intentionally not used here because the
      // existing NDVI/NDWI/NDBI evidence is already sufficient
      // for a factual, token-free summary.
      const vegetationStatus =
        meanNdvi >= 0.60
          ? "High vegetation signal"
          : meanNdvi >= 0.40
            ? "Moderate vegetation signal"
            : meanNdvi >= 0.20
              ? "Low-to-moderate vegetation signal"
              : "Low vegetation signal";

      const waterStatus =
        meanNdwi >= 0.20
          ? "Higher water-related signal"
          : meanNdwi >= 0.00
            ? "Moderate water-related signal"
            : "Low water-related signal";

      const builtupStatus =
        meanNdbi >= 0.20
          ? "Higher built-up signal"
          : meanNdbi >= 0.00
            ? "Moderate built-up signal"
            : "Low built-up signal";

      const deterministicInsight = {
        success: true,
        mode: "deterministic",
        provider: "local-evidence",
        module: "Combined Land Insight",
        phase: "6D",
        insight:
          `Overall Land Condition: ${classification}. ` +
          `The dominant measured indicator is ${dominantType} at ` +
          `${dominantPercentage.toFixed(2)}%.\n\n` +
          `Vegetation: Mean NDVI is ${meanNdvi.toFixed(4)}, ` +
          `with a vegetation indicator of ${vegetationPercentage.toFixed(2)}%. ` +
          `${vegetationStatus}.\n\n` +
          `Water: Mean NDWI is ${meanNdwi.toFixed(4)}, ` +
          `with a water indicator of ${waterPercentage.toFixed(2)}%. ` +
          `${waterStatus}.\n\n` +
          `Built-up: Mean NDBI is ${meanNdbi.toFixed(4)}, ` +
          `with a built-up indicator of ${builtupPercentage.toFixed(2)}%. ` +
          `${builtupStatus}.\n\n` +
          `Short Conclusion: The measured NDVI, NDWI and NDBI indicators ` +
          `should be considered together when interpreting this scene.`,
      };

      setCombinedLandResult({
        ...combinedData,
        land_characteristics: {
          dominant_type: dominantType,
          dominant_percentage: dominantPercentage,
          classification,
          composition: {
            vegetation: vegetationPercentage,
            water: waterPercentage,
            builtup: builtupPercentage,
          },
        },
        combined_statistics: {
          vegetation_percentage: vegetationPercentage,
          water_percentage: waterPercentage,
          builtup_percentage: builtupPercentage,
          classified_total_percentage: classifiedTotalPercentage,
          other_percentage: otherPercentage,
          overlap_detected: overlapDetected,
        },
        ai_insight: deterministicInsight,
      });
    } catch (err) {
      console.error("Combined Land Intelligence failed:", err);
      setCombinedLandError(
        err?.message || "Combined Land Intelligence could not be completed."
      );
    } finally {
      setIsCombinedLandAnalyzing(false);
    }
  };

  
  // =========================================================
  // PHASE 7 — MULTISPECTRAL CHANGE DETECTION
  // =========================================================
  const analyzeMultispectralChange = async ({ before, after }) => {
    setMultispectralChangeError("");
    setMultispectralChangeResult(null);
    setMultispectralAiInsight(null);
    setIsMultispectralChangeAnalyzing(true);

    try {
      const apiBase =
        import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

      const getNumber = (...values) => {
        for (const value of values) {
          const numeric = Number(value);
          if (Number.isFinite(numeric)) return numeric;
        }
        return null;
      };

      const metricValues = {
        before_mean_ndvi: getNumber(
          before?.ndvi?.mean_ndvi,
          before?.ndvi?.stats?.mean,
          before?.ndvi?.mean
        ),
        after_mean_ndvi: getNumber(
          after?.ndvi?.mean_ndvi,
          after?.ndvi?.stats?.mean,
          after?.ndvi?.mean
        ),
        before_vegetation_percentage: getNumber(
          before?.ndvi?.vegetation_percentage,
          before?.ndvi?.stats?.vegetation_percentage,
          before?.ndvi?.vegetation_percent
        ),
        after_vegetation_percentage: getNumber(
          after?.ndvi?.vegetation_percentage,
          after?.ndvi?.stats?.vegetation_percentage,
          after?.ndvi?.vegetation_percent
        ),
        before_mean_ndwi: getNumber(
          before?.ndwi?.mean_ndwi,
          before?.ndwi?.stats?.mean,
          before?.ndwi?.mean
        ),
        after_mean_ndwi: getNumber(
          after?.ndwi?.mean_ndwi,
          after?.ndwi?.stats?.mean,
          after?.ndwi?.mean
        ),
        before_water_percentage: getNumber(
          before?.ndwi?.water_percentage,
          before?.ndwi?.stats?.water_percentage,
          before?.ndwi?.water_percent
        ),
        after_water_percentage: getNumber(
          after?.ndwi?.water_percentage,
          after?.ndwi?.stats?.water_percentage,
          after?.ndwi?.water_percent
        ),
        before_mean_ndbi: getNumber(
          before?.ndbi?.mean_ndbi,
          before?.ndbi?.stats?.mean,
          before?.ndbi?.mean
        ),
        after_mean_ndbi: getNumber(
          after?.ndbi?.mean_ndbi,
          after?.ndbi?.stats?.mean,
          after?.ndbi?.mean
        ),
        before_builtup_percentage: getNumber(
          before?.ndbi?.builtup_percentage,
          before?.ndbi?.stats?.builtup_percentage,
          before?.ndbi?.builtup_percent
        ),
        after_builtup_percentage: getNumber(
          after?.ndbi?.builtup_percentage,
          after?.ndbi?.stats?.builtup_percentage,
          after?.ndbi?.builtup_percent
        ),
      };

      const missing = Object.entries(metricValues)
        .filter(([, value]) => value === null)
        .map(([key]) => key);

      if (missing.length) {
        throw new Error(
          `Multispectral comparison needs valid before/after NDVI, NDWI and NDBI statistics. Missing: ${missing.join(", ")}`
        );
      }

      const form = new FormData();
      Object.entries(metricValues).forEach(([key, value]) => {
        form.append(key, String(value));
      });

      const response = await fetch(
        `${apiBase}/api/multispectral-change-detection`,
        { method: "POST", body: form }
      );

      const data = await response.json();

      if (!response.ok || !data?.success) {
        throw new Error(
          data?.error || "Multispectral change detection failed."
        );
      }

      setMultispectralChangeResult(data);

      const aiForm = new FormData();
      Object.entries(metricValues).forEach(([key, value]) => {
        aiForm.append(key, String(value));
      });
      aiForm.append(
        "change_summary",
        data?.interpretation?.summary || ""
      );

      const aiResponse = await fetch(
        `${apiBase}/api/multispectral-change-ai-insight`,
        { method: "POST", body: aiForm }
      );

      const aiData = await aiResponse.json();

      if (aiResponse.ok && aiData?.success) {
        setMultispectralAiInsight(aiData);
      } else {
        setMultispectralChangeError(
          aiData?.error || "Multispectral AI insight failed."
        );
      }
    } catch (err) {
      console.error("Multispectral change failed:", err);
      setMultispectralChangeError(
        err?.message || "Unable to calculate multispectral change."
      );
    } finally {
      setIsMultispectralChangeAnalyzing(false);
    }
  };

const analyzeImage = async () => {
    if (!selectedFile) {
      return;
    }

    const userQuestion =
      question.trim() ||
      "Give an overall analysis of this satellite image. Identify visible land cover, vegetation, water bodies, buildings, roads, agriculture and any notable spatial patterns.";

    setIsAnalyzing(true);
    setAnswer(null);

    setNdviResult(null);
    setNdviError("");

    setNdwiResult(null);
    setNdwiError("");

    setNdbiResult(null);
    setNdbiError("");

    setError("");

    try {
      let ndviEvidence = "";
      let ndwiEvidence = "";
      let ndbiEvidence = "";

      let latestNdviResult = null;
      let latestNdwiResult = null;
      let latestNdbiResult = null;

      // =====================================================
      // NDVI
      // =====================================================

      if (activeScene && activeAreaBounds) {
        try {
          const ndvi = await analyzeNDVI({
            scene: activeScene,
            areaBounds: activeAreaBounds,
          });

          setNdviResult(ndvi);
          latestNdviResult = ndvi;

          const stats =
            ndvi?.stats ||
            ndvi?.statistics ||
            {};

          const mean =
            stats.mean ??
            ndvi?.mean_ndvi ??
            ndvi?.mean ??
            null;

          const min =
            stats.min ??
            ndvi?.min_ndvi ??
            ndvi?.min ??
            null;

          const max =
            stats.max ??
            ndvi?.max_ndvi ??
            ndvi?.max ??
            null;

          const vegetation =
            stats.vegetation_percentage ??
            ndvi?.vegetation_percentage ??
            ndvi?.vegetation_percent ??
            null;

          const health =
            stats.vegetation_health ??
            ndvi?.vegetation_health ??
            ndvi?.health ??
            "Unknown";

          ndviEvidence = `

NDVI ANALYSIS EVIDENCE FROM THE SAME SENTINEL-2 AOI:
Mean NDVI: ${
            mean !== null
              ? Number(mean).toFixed(4)
              : "Unavailable"
          }
Minimum NDVI: ${
            min !== null
              ? Number(min).toFixed(4)
              : "Unavailable"
          }
Maximum NDVI: ${
            max !== null
              ? Number(max).toFixed(4)
              : "Unavailable"
          }
Vegetation area (NDVI > 0.20): ${
            vegetation !== null
              ? `${Number(vegetation).toFixed(2)}%`
              : "Unavailable"
          }
Vegetation health: ${health}

Use these numerical NDVI values together with the visible satellite image. Do not invent different NDVI values.`;
        } catch (ndviErr) {
          console.error(
            "NDVI analysis failed:",
            ndviErr
          );

          setNdviError(
            ndviErr?.message ||
              "NDVI analysis failed. AI image analysis will continue."
          );
        }
      }

      // =====================================================
      // NDWI
      // =====================================================

      if (activeScene && activeAreaBounds) {
        try {
          const ndwi = await analyzeNDWI({
            scene: activeScene,
            areaBounds: activeAreaBounds,
          });

          setNdwiResult(ndwi);
          latestNdwiResult = ndwi;

          const stats =
            ndwi?.stats ||
            ndwi?.statistics ||
            {};

          const mean =
            stats.mean ??
            ndwi?.mean_ndwi ??
            ndwi?.mean ??
            null;

          const min =
            stats.min ??
            ndwi?.min_ndwi ??
            ndwi?.min ??
            null;

          const max =
            stats.max ??
            ndwi?.max_ndwi ??
            ndwi?.max ??
            null;

          const water =
            stats.water_percentage ??
            ndwi?.water_percentage ??
            ndwi?.water_percent ??
            null;

          const status =
            stats.water_status ??
            ndwi?.water_status ??
            ndwi?.status ??
            "Unknown";

          ndwiEvidence = `

NDWI ANALYSIS EVIDENCE FROM THE SAME SENTINEL-2 AOI:
Mean NDWI: ${
            mean !== null
              ? Number(mean).toFixed(4)
              : "Unavailable"
          }
Minimum NDWI: ${
            min !== null
              ? Number(min).toFixed(4)
              : "Unavailable"
          }
Maximum NDWI: ${
            max !== null
              ? Number(max).toFixed(4)
              : "Unavailable"
          }
Water area (NDWI > 0.20): ${
            water !== null
              ? `${Number(water).toFixed(2)}%`
              : "Unavailable"
          }
Water status: ${status}

Use these numerical NDWI values together with the visible satellite image. Do not invent different NDWI values.`;
        } catch (ndwiErr) {
          console.error(
            "NDWI analysis failed:",
            ndwiErr
          );

          setNdwiError(
            ndwiErr?.message ||
              "NDWI analysis failed. AI image analysis will continue."
          );
        }
      }

      // =====================================================
      // NDBI
      // =====================================================

      if (activeScene && activeAreaBounds) {
        try {
          const ndbi = await analyzeNDBI({
            scene: activeScene,
            areaBounds: activeAreaBounds,
          });

          setNdbiResult(ndbi);
          latestNdbiResult = ndbi;

          const stats =
            ndbi?.stats ||
            ndbi?.statistics ||
            {};

          const mean =
            stats.mean ??
            ndbi?.mean_ndbi ??
            ndbi?.mean ??
            null;

          const min =
            stats.min ??
            ndbi?.min_ndbi ??
            ndbi?.min ??
            null;

          const max =
            stats.max ??
            ndbi?.max_ndbi ??
            ndbi?.max ??
            null;

          const builtup =
            stats.builtup_percentage ??
            ndbi?.builtup_percentage ??
            ndbi?.builtup_percent ??
            null;

          const status =
            stats.builtup_status ??
            ndbi?.builtup_status ??
            ndbi?.status ??
            "Unknown";

          ndbiEvidence = `

NDBI ANALYSIS EVIDENCE FROM THE SAME SENTINEL-2 AOI:
Mean NDBI: ${
            mean !== null
              ? Number(mean).toFixed(4)
              : "Unavailable"
          }
Minimum NDBI: ${
            min !== null
              ? Number(min).toFixed(4)
              : "Unavailable"
          }
Maximum NDBI: ${
            max !== null
              ? Number(max).toFixed(4)
              : "Unavailable"
          }
Built-up area (NDBI > 0.20): ${
            builtup !== null
              ? `${Number(builtup).toFixed(2)}%`
              : "Unavailable"
          }
Built-up status: ${status}

Use these numerical NDBI values together with the visible satellite image. Do not invent different NDBI values.`;
        } catch (ndbiErr) {
          console.error(
            "NDBI analysis failed:",
            ndbiErr
          );

          setNdbiError(
            ndbiErr?.message ||
              "NDBI analysis failed. AI image analysis will continue."
          );
        }
      }

      // =====================================================
      // ANALYSIS — COMBINED LAND INTELLIGENCE
      // =====================================================

      if (activeScene && activeAreaBounds) {
        if (latestNdviResult && latestNdwiResult && latestNdbiResult) {
          await analyzeCombinedLandIntelligence({
            ndvi: latestNdviResult,
            ndwi: latestNdwiResult,
            ndbi: latestNdbiResult,
          });
        } else {
          setCombinedLandError(
            "Combined Land Intelligence needs successful NDVI, NDWI and NDBI results."
          );
        }
      }

      // =====================================================
      // SEND ALL EVIDENCE TO AI
      // =====================================================

      const combinedQuestion =
        `${userQuestion}${ndviEvidence}${ndwiEvidence}${ndbiEvidence}`;

      // Phase 9C — HF credits are exhausted.
      // Do not call the VQA endpoint, so no 402 request is generated.
      // The rest of the satellite analysis remains fully available.
      setAnswer({
        success: false,
        mode: "unavailable",
        provider: "huggingface-unavailable",
        answer:
          "Satellite image question answering is temporarily unavailable because the AI inference credits are exhausted. " +
          "NDVI, NDWI, NDBI and the deterministic satellite intelligence modules remain available.",
      });
    } catch (err) {
      const errorMessage =
        err?.message ||
        "Unable to connect to the AI backend.";

      // =====================================================
      // PHASE 9C — TOKEN-FREE VQA STATUS
      // Keep the satellite analysis usable when HF credits
      // are exhausted instead of showing a raw 402 error.
      // =====================================================
      if (
        errorMessage.includes("402") ||
        errorMessage.toLowerCase().includes("payment required") ||
        errorMessage.toLowerCase().includes("credits")
      ) {
        setAnswer({
          success: false,
          mode: "unavailable",
          provider: "huggingface-unavailable",
          answer:
            "Satellite image question answering is temporarily unavailable because the AI inference credits are exhausted. " +
            "The satellite image, NDVI, NDWI, NDBI, land intelligence, change detection and temporal analysis remain available.",
        });
        setError("");
      } else {
        setError(errorMessage);
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  // =========================================================
  // CLEANUP
  // =========================================================

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const suggestions = [
    "What objects are visible?",
    "Are there any buildings?",
    "Identify vegetation",
    "Find water bodies",
    "Detect roads",
    "Describe the land cover",
    "Are there agricultural areas?",
  ];

  // =========================================================
  // PHASE 8F / 8G — TEMPORAL STATISTICS + CHART HELPERS
  // =========================================================

  const getTemporalMetric = (row, index) => {
    const key = index === "NDVI" ? "ndvi" : index === "NDWI" ? "ndwi" : "ndbi";
    const value = row?.[key]?.mean;
    return Number.isFinite(Number(value)) ? Number(value) : null;
  };

  const getTemporalPercentage = (row, index) => {
    const key = index === "NDVI" ? "ndvi" : index === "NDWI" ? "ndwi" : "ndbi";
    const value = row?.[key]?.percentage;
    return Number.isFinite(Number(value)) ? Number(value) : null;
  };

  const temporalRows = [...unifiedTemporalResults].sort(
    (a, b) => Number(a?.analysis_year || 0) - Number(b?.analysis_year || 0)
  );

  const temporalStats = selectedTemporalIndices.reduce((acc, index) => {
    const values = temporalRows
      .map((row) => getTemporalMetric(row, index))
      .filter((value) => value !== null);

    const percentages = temporalRows
      .map((row) => getTemporalPercentage(row, index))
      .filter((value) => value !== null);

    if (!values.length) {
      acc[index] = null;
      return acc;
    }

    const first = values[0];
    const last = values[values.length - 1];
    const highest = Math.max(...values);
    const lowest = Math.min(...values);
    const highestYear = temporalRows.find((row) => getTemporalMetric(row, index) === highest)?.analysis_year;
    const lowestYear = temporalRows.find((row) => getTemporalMetric(row, index) === lowest)?.analysis_year;
    const delta = last - first;

    acc[index] = {
      first,
      last,
      delta,
      firstYear: temporalRows[0]?.analysis_year,
      lastYear: temporalRows[temporalRows.length - 1]?.analysis_year,
      highest,
      lowest,
      highestYear,
      lowestYear,
      percentageDelta:
        percentages.length >= 2 ? percentages[percentages.length - 1] - percentages[0] : null,
      values,
    };
    return acc;
  }, {});


  // =========================================================
  // PHASE 8H — DETERMINISTIC TEMPORAL SUMMARY
  // =========================================================
  // Uses only the already-computed Phase 8 temporal results.
  // No new satellite processing or AI/API call is required.

  const getTemporalDirection = (delta) => {
    if (!Number.isFinite(Number(delta))) return "Unavailable";
    const numericDelta = Number(delta);
    if (Math.abs(numericDelta) < 0.01) return "Stable";
    return numericDelta > 0 ? "Increasing" : "Decreasing";
  };

  const temporalSummaryStats = selectedTemporalIndices.reduce((acc, index) => {
    const stat = temporalStats[index];

    if (!stat) {
      acc[index] = null;
      return acc;
    }

    acc[index] = {
      ...stat,
      direction: getTemporalDirection(stat.delta),
    };

    return acc;
  }, {});

  const temporalDirections = selectedTemporalIndices
    .map((index) => temporalSummaryStats[index]?.direction)
    .filter(Boolean);

  const overallTemporalObservation = (() => {
    if (!temporalRows.length || !temporalDirections.length) {
      return "No temporal observation is available yet.";
    }

    if (temporalRows.length === 1) {
      return `Temporal analysis contains one available year (${temporalRows[0]?.analysis_year}); a multi-year trend cannot be established.`;
    }

    const uniqueDirections = [...new Set(temporalDirections)];

    if (uniqueDirections.length === 1) {
      const direction = uniqueDirections[0].toLowerCase();
      return `Across the selected indices, the overall mean-index movement is ${direction} from the first available year to the last available year.`;
    }

    if (uniqueDirections.includes("Stable") && uniqueDirections.length === 2) {
      return "The selected indices show a mixed temporal pattern, with at least one relatively stable indicator and another changing between the first and last available years.";
    }

    return "The selected indices show mixed temporal movement between the first and last available years.";
  })();

  // =========================================================
  // PHASE 9A — EVIDENCE COLLECTION
  // =========================================================
  // Uses only results already produced by SatQuery-AI.
  // No HF token, AI request, or extra satellite processing.

  const getPhase9IndexEvidence = (result, index) => {
    const stats = result?.stats || result?.statistics || {};
    const meanKey = `mean_${index.toLowerCase()}`;
    const percentageKey =
      index === "NDVI"
        ? "vegetation_percentage"
        : index === "NDWI"
          ? "water_percentage"
          : "builtup_percentage";

    const mean =
      stats.mean ??
      result?.[meanKey] ??
      result?.mean ??
      null;

    const percentage =
      stats[percentageKey] ??
      result?.[percentageKey] ??
      result?.[percentageKey.replace("_percentage", "_percent")] ??
      null;

    return {
      mean: Number.isFinite(Number(mean)) ? Number(mean) : null,
      percentage: Number.isFinite(Number(percentage))
        ? Number(percentage)
        : null,
    };
  };

  const phase9Evidence = {
    image: Boolean(selectedFile),
    aoi: Boolean(activeAreaBounds),
    ndvi: getPhase9IndexEvidence(ndviResult, "NDVI"),
    ndwi: getPhase9IndexEvidence(ndwiResult, "NDWI"),
    ndbi: getPhase9IndexEvidence(ndbiResult, "NDBI"),
    combinedLand: Boolean(combinedLandResult),
    change: Boolean(multispectralChangeResult?.success),
    temporal: Boolean(temporalRows.length),
  };

  const phase9EvidenceCount = [
    phase9Evidence.image && phase9Evidence.aoi,
    phase9Evidence.ndvi.mean !== null,
    phase9Evidence.ndwi.mean !== null,
    phase9Evidence.ndbi.mean !== null,
    phase9Evidence.combinedLand,
    phase9Evidence.change,
    phase9Evidence.temporal,
  ].filter(Boolean).length;

  // =========================================================
  // PHASE 9B — DETERMINISTIC SATELLITE INTELLIGENCE
  // =========================================================
  // Converts already-computed evidence into a single factual
  // satellite intelligence layer. No HF request or new
  // satellite processing is performed.

  const phase9Signal = (mean, type) => {
    if (!Number.isFinite(Number(mean))) return "Unavailable";

    const value = Number(mean);

    if (type === "NDVI") {
      if (value >= 0.60) return "High vegetation signal";
      if (value >= 0.40) return "Moderate vegetation signal";
      if (value >= 0.20) return "Low-to-moderate vegetation signal";
      return "Low vegetation signal";
    }

    if (type === "NDWI") {
      if (value >= 0.20) return "Higher water-related signal";
      if (value >= 0.00) return "Moderate water-related signal";
      return "Low water-related signal";
    }

    if (type === "NDBI") {
      if (value >= 0.20) return "Higher built-up signal";
      if (value >= 0.00) return "Moderate built-up signal";
      return "Low built-up signal";
    }

    return "Unavailable";
  };

  const phase9IndexFindings = [
    {
      index: "NDVI",
      evidence: phase9Evidence.ndvi,
      signal: phase9Signal(phase9Evidence.ndvi.mean, "NDVI"),
    },
    {
      index: "NDWI",
      evidence: phase9Evidence.ndwi,
      signal: phase9Signal(phase9Evidence.ndwi.mean, "NDWI"),
    },
    {
      index: "NDBI",
      evidence: phase9Evidence.ndbi,
      signal: phase9Signal(phase9Evidence.ndbi.mean, "NDBI"),
    },
  ];

  const phase9ChangeObservation =
    multispectralChangeResult?.interpretation?.summary ||
    multispectralChangeResult?.summary ||
    "No multispectral change observation is available yet.";

  const phase9LandObservation =
    combinedLandResult?.land_characteristics?.classification
      ? `${combinedLandResult.land_characteristics.classification}; ` +
        `dominant measured indicator: ` +
        `${combinedLandResult.land_characteristics.dominant_type}.`
      : "Combined land-characteristic evidence is not available yet.";

  const phase9BOverallObservation = (() => {
    const available = phase9IndexFindings.filter(
      (item) => item.evidence.mean !== null
    );

    if (!available.length) {
      return "No deterministic satellite intelligence is available yet.";
    }

    const signals = available.map((item) => item.signal).join("; ");

    if (combinedLandResult?.land_characteristics?.classification) {
      return (
        `${phase9LandObservation} ` +
        `Index evidence: ${signals}.`
      );
    }

    return `Index evidence: ${signals}.`;
  })();

  // =========================================================
  // PHASE 9D — EVIDENCE EXPLANATION
  // =========================================================
  // Explains which completed SatQuery-AI module supports each
  // observation. This is descriptive only and does not infer
  // causes or fabricate confidence probabilities.

  const phase9DEvidenceItems = [
    {
      key: "ndvi",
      title: "Vegetation Observation",
      source: "NDVI Analysis",
      available: phase9Evidence.ndvi.mean !== null,
      detail:
        phase9Evidence.ndvi.mean !== null
          ? `Mean NDVI ${phase9Evidence.ndvi.mean.toFixed(4)} with an indicator of ${
              phase9Evidence.ndvi.percentage === null
                ? "—"
                : `${phase9Evidence.ndvi.percentage.toFixed(2)}%`
            }.`
          : "NDVI evidence is not available yet.",
      interpretation:
        phase9Evidence.ndvi.mean !== null
          ? phase9Signal(phase9Evidence.ndvi.mean, "NDVI")
          : "No vegetation observation can be described yet.",
    },
    {
      key: "ndwi",
      title: "Water Observation",
      source: "NDWI Analysis",
      available: phase9Evidence.ndwi.mean !== null,
      detail:
        phase9Evidence.ndwi.mean !== null
          ? `Mean NDWI ${phase9Evidence.ndwi.mean.toFixed(4)} with an indicator of ${
              phase9Evidence.ndwi.percentage === null
                ? "—"
                : `${phase9Evidence.ndwi.percentage.toFixed(2)}%`
            }.`
          : "NDWI evidence is not available yet.",
      interpretation:
        phase9Evidence.ndwi.mean !== null
          ? phase9Signal(phase9Evidence.ndwi.mean, "NDWI")
          : "No water-related observation can be described yet.",
    },
    {
      key: "ndbi",
      title: "Built-up Observation",
      source: "NDBI Analysis",
      available: phase9Evidence.ndbi.mean !== null,
      detail:
        phase9Evidence.ndbi.mean !== null
          ? `Mean NDBI ${phase9Evidence.ndbi.mean.toFixed(4)} with an indicator of ${
              phase9Evidence.ndbi.percentage === null
                ? "—"
                : `${phase9Evidence.ndbi.percentage.toFixed(2)}%`
            }.`
          : "NDBI evidence is not available yet.",
      interpretation:
        phase9Evidence.ndbi.mean !== null
          ? phase9Signal(phase9Evidence.ndbi.mean, "NDBI")
          : "No built-up observation can be described yet.",
    },
    {
      key: "land",
      title: "Land Characteristic",
      source: "Combined Land Intelligence",
      available: phase9Evidence.combinedLand,
      detail: phase9Evidence.combinedLand
        ? phase9LandObservation
        : "Combined land-intelligence evidence is not available yet.",
      interpretation: phase9Evidence.combinedLand
        ? "Derived from the completed NDVI, NDWI and NDBI land indicators."
        : "No combined land observation can be described yet.",
    },
    {
      key: "change",
      title: "Change Observation",
      source: "Multispectral Change Detection",
      available: phase9Evidence.change,
      detail: phase9Evidence.change
        ? phase9ChangeObservation
        : "Multispectral change evidence is not available yet.",
      interpretation: phase9Evidence.change
        ? "Supported by the completed before/after multispectral comparison."
        : "No change observation can be described yet.",
    },
    {
      key: "temporal",
      title: "Temporal Observation",
      source: "Multi-Temporal Analysis",
      available: phase9Evidence.temporal,
      detail: phase9Evidence.temporal
        ? overallTemporalObservation
        : "Temporal evidence is not available yet.",
      interpretation: phase9Evidence.temporal
        ? `Supported by ${temporalRows.length} analyzed year${temporalRows.length === 1 ? "" : "s"}.`
        : "No temporal observation can be described yet.",
    },
  ];

  const phase9DAvailableEvidence = phase9DEvidenceItems.filter(
    (item) => item.available
  );

  const phase9DExplanationCount = phase9DAvailableEvidence.length;

  const temporalChartColors = {
    NDVI: "#34d399",
    NDWI: "#60a5fa",
    NDBI: "#8b5e3c",
  };

  const renderTemporalChart = (index) => {
    const rows = temporalRows
      .map((row) => ({
        year: row?.analysis_year,
        value: getTemporalMetric(row, index),
      }))
      .filter((item) => item.value !== null);

    if (!rows.length) return null;

    const values = rows.map((item) => item.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const points = rows
      .map((item, i) => {
        const x = rows.length === 1 ? 50 : (i / (rows.length - 1)) * 100;
        const y = 90 - ((item.value - min) / range) * 70;
        return `${x},${y}`;
      })
      .join(" ");

    return (
      <div key={index} className="rounded-2xl border border-white/10 bg-black/20 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-200">{index} Trend</p>
            <p className="mt-1 text-[11px] text-gray-500">
              Mean index value across available years
            </p>
          </div>
          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-gray-400">
            {rows.length} YEARS
          </span>
        </div>

        <div className="mt-5 rounded-xl border border-white/5 bg-[#050912] p-3">
          <svg viewBox="0 0 100 100" className="h-44 w-full overflow-visible" preserveAspectRatio="none" aria-label={`${index} temporal trend`}>
            <line x1="0" y1="20" x2="100" y2="20" stroke="rgba(255,255,255,0.07)" strokeWidth="0.5" />
            <line x1="0" y1="55" x2="100" y2="55" stroke="rgba(255,255,255,0.07)" strokeWidth="0.5" />
            <line x1="0" y1="90" x2="100" y2="90" stroke="rgba(255,255,255,0.10)" strokeWidth="0.6" />
            <polyline
              points={points}
              fill="none"
              stroke={temporalChartColors[index]}
              strokeWidth="1.8"
              vectorEffect="non-scaling-stroke"
            />
            {rows.map((item, i) => {
              const x = rows.length === 1 ? 50 : (i / (rows.length - 1)) * 100;
              const y = 90 - ((item.value - min) / range) * 70;
              return (
                <circle
                  key={`${index}-${item.year}`}
                  cx={x}
                  cy={y}
                  r="1.8"
                  fill={temporalChartColors[index]}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>

          <div className="mt-1 flex justify-between gap-2 text-[10px] text-gray-600">
            {rows.map((item) => (
              <span key={`${index}-label-${item.year}`}>{item.year}</span>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-gray-600">First</p>
            <p className="mt-1 text-gray-300">{rows[0].value.toFixed(4)}</p>
          </div>
          <div>
            <p className="text-gray-600">Last</p>
            <p className="mt-1 text-gray-300">{rows[rows.length - 1].value.toFixed(4)}</p>
          </div>
        </div>
      </div>
    );
  };

  // =========================================================
  // UI
  // =========================================================

  const hasAnalysisContext = Boolean(selectedFile || activeScene);

  const renderMultispectralChange = () => {
    if (
      !multispectralChangeResult &&
      !isMultispectralChangeAnalyzing &&
      !multispectralChangeError
    ) {
      return null;
    }

    const comparison = multispectralChangeResult?.comparison || {};
    const interpretation = multispectralChangeResult?.interpretation || {};

    const cards = [
      {
        label: "Vegetation",
        metric: "NDVI",
        data: comparison.ndvi,
        percentage: comparison.vegetation,
      },
      {
        label: "Water",
        metric: "NDWI",
        data: comparison.ndwi,
        percentage: comparison.water,
      },
      {
        label: "Built-up",
        metric: "NDBI",
        data: comparison.ndbi,
        percentage: comparison.builtup,
      },
    ];

    return (
      <section className="mt-10 rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-blue-400">
              Change Analysis
            </p>
            <h3 className="mt-1 text-2xl font-semibold">
              Multispectral Change Detection
            </h3>
            <p className="mt-2 text-sm text-gray-400">
              Before → After comparison using NDVI, NDWI and NDBI.
            </p>
          </div>

          {multispectralChangeResult?.success && (
            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-300">
              ANALYSIS COMPLETE
            </span>
          )}
        </div>

        {isMultispectralChangeAnalyzing && (
          <div className="mb-5 rounded-2xl border border-blue-400/20 bg-blue-400/10 p-4 text-sm text-blue-200">
            Comparing multispectral indicators and generating AI insight...
          </div>
        )}

        {multispectralChangeError && (
          <div className="mb-5 rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-300">
            {multispectralChangeError}
          </div>
        )}

        {multispectralChangeResult?.success && (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              {cards.map((card) => {
                const direction = card.percentage?.direction || card.data?.direction;
                const change =
                  card.percentage?.change_percentage_points ??
                  card.data?.change ??
                  0;

                return (
                  <div
                    key={card.label}
                    className="rounded-2xl border border-white/10 bg-black/20 p-5"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-gray-400">{card.label}</p>
                      <span className="text-xs text-gray-500">{card.metric}</span>
                    </div>

                    <div className="mt-4 flex items-end justify-between gap-3">
                      <div>
                        <p className="text-xs text-gray-500">Before → After</p>
                        <p className="mt-1 text-lg font-semibold">
                          {card.percentage?.before_percentage?.toFixed?.(2) ??
                            card.data?.before?.toFixed?.(4) ??
                            "—"}
                          {" → "}
                          {card.percentage?.after_percentage?.toFixed?.(2) ??
                            card.data?.after?.toFixed?.(4) ??
                            "—"}
                          {card.percentage ? "%" : ""}
                        </p>
                      </div>

                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          direction === "increase"
                            ? "bg-emerald-400/10 text-emerald-300"
                            : direction === "decrease"
                              ? "bg-red-400/10 text-red-300"
                              : "bg-white/10 text-gray-300"
                        }`}
                      >
                        {direction || "stable"}
                      </span>
                    </div>

                    <p className="mt-3 text-xs text-gray-500">
                      Change: {Number(change).toFixed(2)}
                      {card.percentage ? " percentage points" : ""}
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-gray-500">
                Detected Changes
              </p>
              <p className="mt-2 text-sm text-gray-200">
                {interpretation.summary || "No major category-level change"}
              </p>
            </div>

            {multispectralAiInsight?.success && (
              <div className="mt-5 rounded-2xl border border-blue-400/20 bg-blue-400/5 p-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-blue-300">
                    Change Interpretation
                  </p>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-gray-400">
                    {multispectralAiInsight.mode === "live"
                      ? "LIVE MODEL"
                      : "DETERMINISTIC"}
                  </span>
                </div>

                <div className="mt-4 whitespace-pre-wrap text-sm leading-7 text-gray-200">
                  {multispectralAiInsight.insight}
                </div>
              </div>
            )}

            <p className="mt-4 text-xs leading-5 text-gray-500">
              NDVI, NDWI and NDBI percentage indicators are independent
              measurements and may overlap; they are not forced into a
              mutually-exclusive 100% land-cover partition.
            </p>
          </>
        )}
      </section>
    );
  };

  return (
    <div className="min-h-screen bg-[#030712] text-white">
      {/* BACKGROUND */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-[5%] top-[-150px] h-[500px] w-[500px] rounded-full bg-blue-600/10 blur-[160px]" />
        <div className="absolute right-[-100px] top-[35%] h-[500px] w-[500px] rounded-full bg-blue-600/10 blur-[170px]" />
      </div>

      {/* NAVBAR */}
      <nav className="relative z-20 flex items-center justify-between border-b border-white/10 bg-black/30 px-8 py-5 backdrop-blur-xl">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-3 text-left"
        >
          <div className="text-3xl">🛰️</div>

          <div>
            <h1 className="text-xl font-semibold">
              SatQuery AI
            </h1>

            <p className="text-[10px] uppercase tracking-[0.25em] text-blue-400">
              Satellite Intelligence
            </p>
          </div>
        </button>

        <button
          onClick={() => navigate("/analysis")}
          className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-gray-300 transition hover:bg-white/10 hover:text-white"
        >
          ← Back to Analysis
        </button>
      </nav>

      {/* MAIN */}
      <main className="relative z-10 mx-auto max-w-7xl px-6 py-12">
        {/* HEADER */}
        <div className="mb-10">
          <div className="mb-4 flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />

            <p className="text-xs uppercase tracking-[0.3em] text-blue-400">
              Image Intelligence
            </p>
          </div>

          <h2 className="text-4xl font-bold md:text-5xl">
            Understand Your{" "}
            <span className="text-blue-400">
              Satellite Image
            </span>
          </h2>

          <p className="mt-4 max-w-2xl text-gray-400">
            Upload an image or select a satellite scene to begin.
          </p>

          <button
            type="button"
            onClick={() => navigate("/analysis/geo")}
            className="mt-5 rounded-xl border border-blue-400/20 bg-blue-400/10 px-4 py-2.5 text-sm font-medium text-blue-300 transition hover:bg-blue-400/20"
          >
            🗺️ Go to GeoLocation
          </button>
        </div>

        <>
        {/* WORKSPACE */}
        <RevealSection>
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          {/* IMAGE WORKSPACE */}
          <div className="relative min-h-[560px] overflow-hidden rounded-3xl border border-white/10 bg-[#050b16]">
            <div
              className="absolute inset-0 opacity-20"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(50,150,255,.15) 1px, transparent 1px), linear-gradient(90deg, rgba(50,150,255,.15) 1px, transparent 1px)",
                backgroundSize: "45px 45px",
              }}
            />

            {/* TOP STATUS */}
            <div className="absolute left-6 right-6 top-6 z-10 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.25em] text-gray-500">
                  Satellite Workspace
                </p>

                <p className="mt-1 max-w-[420px] truncate text-sm text-gray-300">
                  {fileName ||
                    "No satellite image loaded"}
                </p>
              </div>

              <span
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${
                  previewUrl
                    ? "border-green-400/20 bg-green-400/10 text-green-400"
                    : "border-yellow-400/20 bg-yellow-400/10 text-yellow-400"
                }`}
              >
                ●{" "}
                {previewUrl
                  ? "IMAGE LOADED"
                  : "WAITING"}
              </span>
            </div>

            {/* IMAGE AREA */}
            <div className="absolute inset-0 flex items-center justify-center px-8 pt-14">
              {!previewUrl ? (
                <div className="w-full max-w-2xl">
                  <label
                    htmlFor="image-upload"
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() =>
                      setIsDragging(false)
                    }
                    onDrop={handleDrop}
                    className={`flex min-h-[340px] cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed px-8 text-center transition duration-300 ${
                      isDragging
                        ? "scale-[1.01] border-blue-400 bg-blue-500/10"
                        : "border-blue-400/30 bg-blue-500/[0.03] hover:border-blue-400/60 hover:bg-blue-500/[0.08]"
                    }`}
                  >
                    <div className="mb-6 text-7xl">
                      🛰️
                    </div>

                    <h3 className="text-2xl font-semibold">
                      {isDragging
                        ? "Drop Satellite Image Here"
                        : "Upload Satellite Image"}
                    </h3>

                    <p className="mt-3 max-w-md text-sm leading-6 text-gray-500">
                      Drag and drop a satellite raster here,
                      or click to browse.
                    </p>

                    <div className="mt-6 flex flex-wrap justify-center gap-2">
                      {[
                        "PNG",
                        "JPG",
                        "GeoTIFF",
                        "JP2",
                        "J2K",
                        "NITF",
                      ].map((format) => (
                        <span
                          key={format}
                          className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-gray-500"
                        >
                          {format}
                        </span>
                      ))}
                    </div>

                    {/* DEMO BUTTON */}
                    <div className="mt-5 flex justify-center">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          loadDemoImage();
                        }}
                        className="rounded-xl border border-blue-400/20 bg-blue-500/10 px-5 py-2.5 text-sm font-medium text-blue-300 transition hover:bg-blue-500/20"
                      >
                        ✦ Try Demo Image
                      </button>
                    </div>

                    <p className="mt-4 text-xs text-blue-400/70">
                      PNG/JPG images are previewed directly in
                      the browser.
                    </p>

                    <p className="mt-2 text-xs text-gray-600">
                      Maximum file size: 50 MB
                    </p>
                  </label>

                  {error && (
                    <div className="mt-4 rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                      ⚠️ {error}
                    </div>
                  )}
                </div>
              ) : (
                <div className="relative flex h-full w-full items-center justify-center pb-24 pt-12">
                  {isBrowserPreviewable(
                    selectedFile
                  ) ? (
                    <img
                      src={previewUrl}
                      alt={
                        fileName ||
                        "Uploaded satellite image"
                      }
                      className="max-h-[470px] max-w-full rounded-2xl border border-blue-400/20 object-contain shadow-2xl shadow-blue-900/20"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center rounded-3xl border border-blue-400/20 bg-blue-500/[0.05] px-10 py-16 text-center">
                      <div className="text-6xl">
                        🛰️
                      </div>

                      <p className="mt-5 text-lg font-semibold">
                        Satellite Image Loaded
                      </p>

                      <p className="mt-2 max-w-[350px] truncate text-sm text-gray-500">
                        {fileName}
                      </p>

                      <p className="mt-2 text-xs text-blue-400">
                        {dimensions}
                      </p>

                      <p className="mt-4 max-w-md text-xs leading-5 text-gray-600">
                        Preview is not available for this file type.
                      </p>
                    </div>
                  )}

                  {/* IMAGE INFO BAR */}
                  <div className="absolute bottom-2 left-0 right-0 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/80 px-5 py-4 backdrop-blur-xl">
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500">
                        Uploaded satellite image
                      </p>

                      <p className="max-w-[500px] truncate text-sm text-gray-200">
                        {fileName}
                      </p>

                      <div className="mt-1 flex flex-wrap gap-4 text-[11px] text-gray-500">
                        <span>{fileSize}</span>
                        <span>{dimensions}</span>
                      </div>
                    </div>

                    <button
                      onClick={removeImage}
                      className="rounded-lg border border-red-400/20 bg-red-500/10 px-4 py-2 text-xs text-red-400 transition hover:bg-red-500/20"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* HIDDEN FILE INPUT */}
            <input
              id="image-upload"
              type="file"
              accept=".png,.jpg,.jpeg,.tif,.tiff,.jp2,.j2k,.nitf,image/png,image/jpeg,image/tiff"
              className="hidden"
              onChange={handleFile}
            />
          </div>

          <div>
          {/* AI PANEL */}
          <div className="rounded-3xl border border-blue-500/20 bg-gradient-to-b from-blue-500/[0.08] to-transparent p-6 backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/15 text-xl">
                ✦
              </div>

              <div>
                <h3 className="font-semibold">
                  Image Analysis
                </h3>

                <p className="text-xs text-gray-500">
                  Satellite image intelligence
                </p>
              </div>
            </div>

            {/* STATUS */}
            <div className="mt-6 rounded-xl border border-white/10 bg-black/30 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">
                  ANALYSIS STATUS
                </span>

                <span className="flex items-center gap-2 text-xs text-green-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                  READY
                </span>
              </div>

              <p className="mt-3 text-sm leading-6 text-gray-400">
                {previewUrl
                  ? activeScene
                    ? "Sentinel-2 image ready. Analyze to run image understanding + NDVI + NDWI + NDBI for the selected AOI."
                    : "Image ready for analysis."
                  : "Upload an image to begin."}
              </p>
            </div>

            {/* QUESTION */}
            <div className="mt-6">
              <label className="mb-2 block text-xs uppercase tracking-wider text-gray-500">
                Your Question{" "}
                <span className="text-gray-700">
                  (optional)
                </span>
              </label>

              <textarea
                value={question}
                onChange={(e) =>
                  setQuestion(e.target.value)
                }
                disabled={!previewUrl}
                rows={5}
                placeholder={
                  previewUrl
                    ? "Ask about this image..."
                    : "Upload an image first..."
                }
                className="w-full resize-none rounded-xl border border-white/10 bg-black/40 px-4 py-4 text-sm text-white outline-none placeholder:text-gray-600 focus:border-blue-500/50 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            {/* COMBINED ANALYSIS BUTTON */}
            <button
              disabled={
                !previewUrl ||
                isAnalyzing
              }
              onClick={analyzeImage}
              className={`mt-4 w-full rounded-xl py-3.5 font-semibold transition ${
                previewUrl &&
                !isAnalyzing
                  ? "bg-blue-500 shadow-lg shadow-blue-500/20 hover:bg-blue-400"
                  : "cursor-not-allowed bg-gray-700 text-gray-500"
              }`}
            >
              {isAnalyzing
                ? activeScene
                  ? "Analyzing image + NDVI + NDWI + NDBI..."
                  : "Analyzing satellite image..."
                : "Analyze Image ✦"}
            </button>

            {/* =================================================
                NDVI RESULT
                ================================================= */}

            {ndviResult && (
              <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.05] p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-emerald-400">
                    NDVI Analysis
                  </p>

                  <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] text-emerald-300">
                    SENTINEL-2
                  </span>
                </div>

                {(ndviResult.ndvi_map ||
                  ndviResult.map ||
                  ndviResult.image ||
                  ndviResult.image_url) && (
                  <img
                    src={
                      ndviResult.ndvi_map ||
                      ndviResult.map ||
                      ndviResult.image ||
                      ndviResult.image_url
                    }
                    alt="NDVI map"
                    className="mt-4 w-full rounded-xl border border-white/10 object-contain"
                  />
                )}

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <MetricCard
                    label="Mean"
                    value={
                      ndviResult?.stats?.mean ??
                      ndviResult?.mean_ndvi ??
                      ndviResult?.mean
                    }
                  />

                  <MetricCard
                    label="Minimum"
                    value={
                      ndviResult?.stats?.min ??
                      ndviResult?.min_ndvi ??
                      ndviResult?.min
                    }
                  />

                  <MetricCard
                    label="Maximum"
                    value={
                      ndviResult?.stats?.max ??
                      ndviResult?.max_ndvi ??
                      ndviResult?.max
                    }
                  />

                  <MetricCard
                    label="Vegetation"
                    value={
                      ndviResult?.stats
                        ?.vegetation_percentage ??
                      ndviResult?.vegetation_percentage ??
                      ndviResult?.vegetation_percent
                    }
                    suffix="%"
                  />
                </div>

                <StatusCard
                  label="Vegetation Health"
                  value={
                    ndviResult?.stats
                      ?.vegetation_health ||
                    ndviResult?.vegetation_health ||
                    ndviResult?.health ||
                    "Unavailable"
                  }
                />
              </div>
            )}

            {ndviError && (
              <div className="mt-4 rounded-xl border border-yellow-400/20 bg-yellow-400/[0.06] p-3 text-xs leading-5 text-yellow-300">
                NDVI: {ndviError}
              </div>
            )}

            {/* =================================================
                NDWI RESULT
                ================================================= */}

            {ndwiResult && (
              <div className="mt-5 rounded-2xl border border-blue-400/20 bg-blue-400/[0.05] p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-blue-400">
                    NDWI Analysis
                  </p>

                  <span className="rounded-full border border-blue-400/20 bg-blue-400/10 px-2 py-1 text-[10px] text-blue-300">
                    SENTINEL-2
                  </span>
                </div>

                {(ndwiResult.ndwi_map ||
                  ndwiResult.map ||
                  ndwiResult.image ||
                  ndwiResult.image_url) && (
                  <img
                    src={
                      ndwiResult.ndwi_map ||
                      ndwiResult.map ||
                      ndwiResult.image ||
                      ndwiResult.image_url
                    }
                    alt="NDWI map"
                    className="mt-4 w-full rounded-xl border border-white/10 object-contain"
                  />
                )}

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <MetricCard
                    label="Mean"
                    value={
                      ndwiResult?.stats?.mean ??
                      ndwiResult?.mean_ndwi ??
                      ndwiResult?.mean
                    }
                  />

                  <MetricCard
                    label="Minimum"
                    value={
                      ndwiResult?.stats?.min ??
                      ndwiResult?.min_ndwi ??
                      ndwiResult?.min
                    }
                  />

                  <MetricCard
                    label="Maximum"
                    value={
                      ndwiResult?.stats?.max ??
                      ndwiResult?.max_ndwi ??
                      ndwiResult?.max
                    }
                  />

                  <MetricCard
                    label="Water"
                    value={
                      ndwiResult?.stats
                        ?.water_percentage ??
                      ndwiResult?.water_percentage ??
                      ndwiResult?.water_percent
                    }
                    suffix="%"
                  />
                </div>

                <StatusCard
                  label="Water Status"
                  value={
                    ndwiResult?.stats
                      ?.water_status ||
                    ndwiResult?.water_status ||
                    ndwiResult?.status ||
                    "Unavailable"
                  }
                />
              </div>
            )}

            {ndwiError && (
              <div className="mt-4 rounded-xl border border-yellow-400/20 bg-yellow-400/[0.06] p-3 text-xs leading-5 text-yellow-300">
                NDWI: {ndwiError}
              </div>
            )}

            {/* =================================================
                NDBI RESULT
                ================================================= */}

            {ndbiResult && (
              <div className="mt-5 rounded-2xl border border-[#8b5e3c]/30 bg-[#8b5e3c]/[0.06] p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-[#a66a45]">
                    NDBI Analysis
                  </p>

                  <span className="rounded-full border border-orange-400/20 bg-orange-400/10 px-2 py-1 text-[10px] text-orange-300">
                    SENTINEL-2
                  </span>
                </div>

                {(ndbiResult.ndbi_map ||
                  ndbiResult.map ||
                  ndbiResult.image ||
                  ndbiResult.image_url) && (
                  <img
                    src={
                      ndbiResult.ndbi_map ||
                      ndbiResult.map ||
                      ndbiResult.image ||
                      ndbiResult.image_url
                    }
                    alt="NDBI map"
                    className="mt-4 w-full rounded-xl border border-white/10 object-contain"
                  />
                )}

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <MetricCard
                    label="Mean"
                    value={
                      ndbiResult?.stats?.mean ??
                      ndbiResult?.mean_ndbi ??
                      ndbiResult?.mean
                    }
                  />

                  <MetricCard
                    label="Minimum"
                    value={
                      ndbiResult?.stats?.min ??
                      ndbiResult?.min_ndbi ??
                      ndbiResult?.min
                    }
                  />

                  <MetricCard
                    label="Maximum"
                    value={
                      ndbiResult?.stats?.max ??
                      ndbiResult?.max_ndbi ??
                      ndbiResult?.max
                    }
                  />

                  <MetricCard
                    label="Built-up"
                    value={
                      ndbiResult?.stats
                        ?.builtup_percentage ??
                      ndbiResult?.builtup_percentage ??
                      ndbiResult?.builtup_percent
                    }
                    suffix="%"
                  />
                </div>

                <StatusCard
                  label="Built-up Status"
                  value={
                    ndbiResult?.stats
                      ?.builtup_status ||
                    ndbiResult?.builtup_status ||
                    ndbiResult?.status ||
                    "Unavailable"
                  }
                />
              </div>
            )}

            {ndbiError && (
              <div className="mt-4 rounded-xl border border-yellow-400/20 bg-yellow-400/[0.06] p-3 text-xs leading-5 text-yellow-300">
                NDBI: {ndbiError}
              </div>
            )}

            {/* =================================================
                ANALYSIS — COMBINED LAND INTELLIGENCE
                ================================================= */}

            {combinedLandResult && (
              <div className="mt-6 rounded-2xl border border-blue-400/20 bg-blue-400/[0.05] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-blue-400">
                      Combined Land Intelligence
                    </p>
                    <p className="mt-1 text-[11px] text-gray-500">
                      NDVI + NDWI + NDBI • Same Sentinel-2 AOI
                    </p>
                  </div>
                  
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  <MetricCard
                    label="Vegetation"
                    value={combinedLandResult.summary?.vegetation_percentage}
                    suffix="%"
                  />
                  <MetricCard
                    label="Water"
                    value={combinedLandResult.summary?.water_percentage}
                    suffix="%"
                  />
                  <MetricCard
                    label="Built-up"
                    value={combinedLandResult.summary?.builtup_percentage}
                    suffix="%"
                  />
                </div>

                {combinedLandResult.land_characteristics && (
                  <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-gray-500">
                      Land Characteristics
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <span className="text-sm text-gray-300">
                        {combinedLandResult.land_characteristics.classification}
                      </span>
                      <span className="text-sm font-semibold text-blue-300">
                        {Number(
                          combinedLandResult.land_characteristics.dominant_percentage
                        ).toFixed(2)}%
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      Dominant type:{" "}
                      {combinedLandResult.land_characteristics.dominant_type}
                    </p>
                  </div>
                )}

                {combinedLandResult.combined_statistics && (
                  <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-gray-500">
                      Combined Statistics
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-gray-500">Classified total</span>
                        <p className="mt-1 font-medium text-gray-200">
                          {Number(
                            combinedLandResult.combined_statistics
                              .classified_total_percentage
                          ).toFixed(2)}%
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-500">Other</span>
                        <p className="mt-1 font-medium text-gray-200">
                          {Number(
                            combinedLandResult.combined_statistics
                              .other_percentage
                          ).toFixed(2)}%
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 rounded-lg border border-yellow-400/10 bg-yellow-400/[0.04] px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wider text-gray-500">
                        Index overlap
                      </p>
                      <p className="mt-1 text-xs text-gray-300">
                        {combinedLandResult.combined_statistics.overlap_detected
                          ? "Detected — index percentages are independent masks."
                          : "Not detected in the combined percentage check."}
                      </p>
                    </div>
                  </div>
                )}

                {combinedLandResult.ai_insight && (
                  <div className="mt-3 rounded-xl border border-blue-400/20 bg-blue-400/[0.05] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[10px] uppercase tracking-wider text-blue-300">
                        Land Observation
                      </p>
                      <span className="text-[10px] text-gray-500">
                        {combinedLandResult.ai_insight.mode === "live"
                          ? "LIVE MODEL"
                          : "DETERMINISTIC"}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-200">
                      {combinedLandResult.ai_insight.insight}
                    </p>
                  </div>
                )}
              </div>
            )}

            {isCombinedLandAnalyzing && (
              <div className="mt-5 rounded-xl border border-blue-400/20 bg-blue-400/[0.05] p-3 text-xs text-blue-300">
                Combining NDVI + NDWI + NDBI and generating deterministic land intelligence...
              </div>
            )}

            {combinedLandError && (
              <div className="mt-4 rounded-xl border border-yellow-400/20 bg-yellow-400/[0.06] p-3 text-xs leading-5 text-yellow-300">
                Combined Land Intelligence: {combinedLandError}
              </div>
            )}

            {/* =================================================
                AI ANSWER
                ================================================= */}

            {answer && (
              <div className="mt-5 rounded-2xl border border-green-400/20 bg-green-400/[0.06] p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-green-400">
                    VQA Result
                  </p>

                  <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-gray-400">
                    {answer.mode === "unavailable"
                      ? "AI UNAVAILABLE"
                      : answer.provider === "huggingface"
                      ? "LIVE MODEL"
                      : answer.provider === "local-evidence"
                      ? "DETERMINISTIC"
                      : "DETERMINISTIC"}
                  </span>
                </div>

                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-200">
                  {answer.answer}
                </p>
              </div>
            )}

            {/* ERROR */}
            {error && previewUrl && (
              <div className="mt-4 rounded-xl border border-red-400/20 bg-red-400/[0.06] p-3 text-xs leading-5 text-red-300">
                {error}
              </div>
            )}

            {/* SUGGESTIONS */}
            <div className="mt-7">
              <p className="text-xs uppercase tracking-wider text-gray-600">
                Try asking
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                {suggestions.map((item) => (
                  <button
                    key={item}
                    disabled={!previewUrl}
                    onClick={() =>
                      setQuestion(item)
                    }
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-400 transition hover:border-blue-400/30 hover:text-blue-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        </div>
        </RevealSection>

        {hasAnalysisContext && (
          <>
        {/* =================================================
            MULTI-YEAR SCENE RETRIEVAL
            ================================================= */}
        <RevealSection>
        <section className="mb-8 overflow-hidden rounded-3xl border border-blue-400/20 bg-blue-500/[0.035] shadow-2xl">
          <div className="border-b border-white/10 bg-blue-500/[0.04] px-6 py-6">
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-blue-400">
                  Multi-Temporal Analysis
                </p>
                <h3 className="mt-2 text-2xl font-semibold">
                  Multi-Year Satellite Scenes
                </h3>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
                  Select a year range and retrieve satellite scenes.
                </p>
              </div>

              <span className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-wider ${
                isMultiTemporalLoading
                  ? "border-yellow-400/20 bg-yellow-400/10 text-yellow-400"
                  : multiTemporalScenes.length
                  ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                  : "border-white/10 bg-white/5 text-gray-500"
              }`}>
                {isMultiTemporalLoading ? "RETRIEVING" : multiTemporalScenes.length ? `${multiTemporalScenes.length} YEARS READY` : "READY"}
              </span>
            </div>
          </div>

          <div className="p-6">
            {!activeAreaBounds ? (
              <div className="rounded-2xl border border-yellow-400/20 bg-yellow-400/[0.05] p-4">
                <p className="text-sm font-medium text-yellow-300">Select an Analysis Area first</p>
                <p className="mt-1 text-xs leading-5 text-gray-500">Select an area in GeoLocation first.</p>
              </div>
            ) : (
              <>
                <div className="mb-5 rounded-2xl border border-blue-400/15 bg-black/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-gray-500">Active AOI</p>
                      <p className="mt-1 text-sm text-gray-300">Using the selected area for all years.</p>
                    </div>
                    <span className="rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1 text-[10px] text-blue-300">AOI LOCKED</span>
                  </div>
                  <p className="mt-3 break-all text-xs text-gray-500">{JSON.stringify(activeAreaBounds)}</p>
                </div>

                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {[
                    ["Start Year", multiTemporalStartYear, setMultiTemporalStartYear, "number"],
                    ["End Year", multiTemporalEndYear, setMultiTemporalEndYear, "number"],
                    ["Target Month", multiTemporalMonth, setMultiTemporalMonth, "number"],
                    ["Target Day", multiTemporalDay, setMultiTemporalDay, "number"],
                    ["Search Window (± days)", multiTemporalWindowDays, setMultiTemporalWindowDays, "number"],
                    ["Max Cloud Cover %", multiTemporalCloudCover, setMultiTemporalCloudCover, "number"],
                  ].map(([label, value, setter, type]) => (
                    <label key={label} className="block">
                      <span className="text-xs uppercase tracking-wider text-gray-500">{label}</span>
                      <input
                        type={type}
                        value={value}
                        onChange={(event) => setter(event.target.value)}
                        className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-gray-200 outline-none transition focus:border-blue-400/40"
                      />
                    </label>
                  ))}
                </div>

                <div className="mt-6 flex flex-col items-center gap-2">
                  <button
                    type="button"
                    onClick={retrieveMultiTemporalScenes}
                    disabled={isMultiTemporalLoading}
                    className="rounded-2xl bg-blue-400 px-7 py-3.5 text-sm font-semibold text-black shadow-lg shadow-blue-500/10 transition hover:bg-blue-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isMultiTemporalLoading ? "Retrieving Scenes..." : "🛰️ Retrieve Multi-Year Scenes"}
                  </button>
                  <p className="text-[11px] text-gray-600">Default: 2022 → 2026 · June 15 · ±180 days.</p>
                </div>
              </>
            )}

            {multiTemporalError && (
              <div className="mt-5 rounded-2xl border border-red-400/20 bg-red-500/[0.05] p-4">
                <p className="text-sm text-red-300">{multiTemporalError}</p>
              </div>
            )}

            {multiTemporalScenes.length > 0 && (
              <div className="mt-6 grid gap-3 md:grid-cols-2 lg:grid-cols-5">
                {multiTemporalScenes.map((scene) => (
                  <div key={`${scene.analysis_year}-${scene.id || scene.product_name || "scene"}`} className="rounded-2xl border border-emerald-400/15 bg-emerald-500/[0.035] p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-lg font-semibold text-gray-200">{scene.analysis_year}</span>
                      <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] text-emerald-300">FOUND</span>
                    </div>
                    <p className="mt-3 text-xs text-gray-500">Date: {scene.acquisition_date ? String(scene.acquisition_date).slice(0, 10) : "—"}</p>
                    <p className="mt-1 text-xs text-gray-500">Cloud: {Number.isFinite(Number(scene.cloud_cover)) ? `${Number(scene.cloud_cover).toFixed(1)}%` : "—"}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
        </RevealSection>

        {/* =================================================
            PHASE 8 — UNIFIED MULTI-TEMPORAL INDEX ANALYSIS
            ================================================= */}
        <RevealSection>
        <section className="mb-8 overflow-hidden rounded-3xl border border-blue-400/20 bg-blue-500/[0.035] shadow-2xl">
          <div className="border-b border-white/10 bg-blue-500/[0.04] px-6 py-6">
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-blue-400">
                  Unified Spectral Analysis
                </p>
                <h3 className="mt-2 text-2xl font-semibold">
                  Multi-Temporal Index Analysis
                </h3>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
                  Select the indices to compare across the retrieved years.
                </p>
              </div>

              <span className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-wider ${
                isUnifiedTemporalAnalyzing
                  ? "border-yellow-400/20 bg-yellow-400/10 text-yellow-400"
                  : unifiedTemporalResults.length
                  ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                  : "border-white/10 bg-white/5 text-gray-500"
              }`}>
                {isUnifiedTemporalAnalyzing
                  ? "ANALYZING"
                  : unifiedTemporalResults.length
                  ? `${unifiedTemporalResults.length} YEARS READY`
                  : "READY"}
              </span>
            </div>
          </div>

          <div className="p-6">
            {!multiTemporalScenes.length ? (
              <div className="rounded-2xl border border-yellow-400/20 bg-yellow-400/[0.05] p-4">
                <p className="text-sm font-medium text-yellow-300">Retrieve multi-year scenes first</p>
                <p className="mt-1 text-xs leading-5 text-gray-500">
                  Retrieve multi-year scenes first.
                </p>
              </div>
            ) : (
              <>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-gray-500">Select what you need</p>
                      <p className="mt-1 text-sm text-gray-300">
                        Select one or more indices.
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      {["NDVI", "NDWI", "NDBI"].map((index) => {
                        const checked = selectedTemporalIndices.includes(index);
                        const descriptions = {
                          NDVI: "Vegetation",
                          NDWI: "Water",
                          NDBI: "Built-up",
                        };
                        return (
                          <label
                            key={index}
                            className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition ${
                              checked
                                ? "border-blue-400/40 bg-blue-400/10"
                                : "border-white/10 bg-white/[0.02] hover:border-white/20"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleTemporalIndex(index)}
                              className="h-4 w-4 accent-blue-400"
                            />
                            <span>
                              <span className="block text-sm font-semibold text-gray-200">{index}</span>
                              <span className="block text-[10px] text-gray-500">{descriptions[index]}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-5 flex flex-col items-center gap-2">
                    <button
                      type="button"
                      onClick={analyzeSelectedTemporalIndices}
                      disabled={isUnifiedTemporalAnalyzing || !selectedTemporalIndices.length}
                      className="rounded-2xl bg-blue-400 px-7 py-3.5 text-sm font-semibold text-black shadow-lg shadow-blue-500/10 transition hover:bg-blue-300 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isUnifiedTemporalAnalyzing ? "Analyzing Selected..." : "📊 Analyze Selected"}
                    </button>
                    <p className="text-[11px] text-gray-600">
                      {multiTemporalScenes.length} scene{multiTemporalScenes.length === 1 ? "" : "s"} selected.
                    </p>
                  </div>
                </div>

                {unifiedTemporalValidation?.same_aoi && (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-400/15 bg-emerald-500/[0.04] px-4 py-3">
                    <span className="text-xs text-emerald-300">✓ SAME AOI COVERAGE VERIFIED</span>
                    <span className="text-[11px] text-gray-500">
                      {unifiedTemporalValidation.valid_years?.length || 0}/{multiTemporalScenes.length} scenes valid
                    </span>
                  </div>
                )}

                {unifiedTemporalError && (
                  <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/[0.05] p-4">
                    <p className="text-sm text-red-300">{unifiedTemporalError}</p>
                  </div>
                )}

                {unifiedTemporalResults.length > 0 && (
                  <div className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                    <div className="flex flex-col gap-2 border-b border-white/10 px-5 py-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-gray-200">Year-wise Comparison</p>
                        <p className="mt-1 text-[11px] text-gray-500">
                          {selectedTemporalIndices.join(" + ")} · independent threshold-based percentages
                        </p>
                      </div>
                      <span className="rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1 text-[10px] text-blue-300">
                        {unifiedTemporalResults.length} YEARS
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-xs">
                        <thead className="border-b border-white/10 bg-white/[0.025] text-gray-500">
                          <tr>
                            <th className="whitespace-nowrap px-4 py-3 font-medium">Year</th>
                            <th className="whitespace-nowrap px-4 py-3 font-medium">Date</th>
                            {selectedTemporalIndices.includes("NDVI") && (
                              <>
                                <th className="whitespace-nowrap px-4 py-3 font-medium">Mean NDVI</th>
                                <th className="whitespace-nowrap px-4 py-3 font-medium">Vegetation %</th>
                                <th className="whitespace-nowrap px-4 py-3 font-medium">Health</th>
                              </>
                            )}
                            {selectedTemporalIndices.includes("NDWI") && (
                              <>
                                <th className="whitespace-nowrap px-4 py-3 font-medium">Mean NDWI</th>
                                <th className="whitespace-nowrap px-4 py-3 font-medium">Water %</th>
                                <th className="whitespace-nowrap px-4 py-3 font-medium">Status</th>
                              </>
                            )}
                            {selectedTemporalIndices.includes("NDBI") && (
                              <>
                                <th className="whitespace-nowrap px-4 py-3 font-medium">Mean NDBI</th>
                                <th className="whitespace-nowrap px-4 py-3 font-medium">Built-up %</th>
                                <th className="whitespace-nowrap px-4 py-3 font-medium">Status</th>
                              </>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {unifiedTemporalResults.map((row) => (
                            <tr key={`${row.analysis_year}-${row.scene_id || row.date}`} className="border-b border-white/5 last:border-b-0">
                              <td className="whitespace-nowrap px-4 py-3 font-semibold text-gray-200">{row.analysis_year}</td>
                              <td className="whitespace-nowrap px-4 py-3 text-gray-500">{row.date || "—"}</td>
                              {selectedTemporalIndices.includes("NDVI") && (
                                <>
                                  <td className="whitespace-nowrap px-4 py-3 text-gray-300">{row.ndvi ? Number(row.ndvi.mean).toFixed(4) : "—"}</td>
                                  <td className="whitespace-nowrap px-4 py-3 text-gray-300">{row.ndvi ? `${Number(row.ndvi.percentage).toFixed(2)}%` : "—"}</td>
                                  <td className="whitespace-nowrap px-4 py-3 text-gray-500">{row.ndvi?.health || "—"}</td>
                                </>
                              )}
                              {selectedTemporalIndices.includes("NDWI") && (
                                <>
                                  <td className="whitespace-nowrap px-4 py-3 text-gray-300">{row.ndwi ? Number(row.ndwi.mean).toFixed(4) : "—"}</td>
                                  <td className="whitespace-nowrap px-4 py-3 text-gray-300">{row.ndwi ? `${Number(row.ndwi.percentage).toFixed(2)}%` : "—"}</td>
                                  <td className="whitespace-nowrap px-4 py-3 text-gray-500">{row.ndwi?.status || "—"}</td>
                                </>
                              )}
                              {selectedTemporalIndices.includes("NDBI") && (
                                <>
                                  <td className="whitespace-nowrap px-4 py-3 text-gray-300">{row.ndbi ? Number(row.ndbi.mean).toFixed(4) : "—"}</td>
                                  <td className="whitespace-nowrap px-4 py-3 text-gray-300">{row.ndbi ? `${Number(row.ndbi.percentage).toFixed(2)}%` : "—"}</td>
                                  <td className="whitespace-nowrap px-4 py-3 text-gray-500">{row.ndbi?.status || "—"}</td>
                                </>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {unifiedTemporalResults.length > 0 && (
                  <>
                    {/* =================================================
                        PHASE 8F — TEMPORAL TREND STATISTICS
                        ================================================= */}
                    <div className="mt-6 rounded-2xl border border-blue-400/20 bg-blue-500/[0.035] p-5">
                      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                        <div>
                          <p className="text-xs uppercase tracking-[0.25em] text-blue-300">
                            Trend Statistics
                          </p>
                          <h4 className="mt-1 text-xl font-semibold text-white">
                            Temporal Trend Statistics
                          </h4>
                          <p className="mt-2 text-xs leading-5 text-gray-500">
                            Year-to-year index movement.
                          </p>
                        </div>
                        <span className="w-fit rounded-full border border-blue-300/20 bg-blue-300/10 px-3 py-1 text-[10px] uppercase tracking-wider text-blue-200">
                          {selectedTemporalIndices.length} INDEX{selectedTemporalIndices.length === 1 ? "" : "ES"} ANALYZED
                        </span>
                      </div>

                      <div className="mt-5 grid gap-4 lg:grid-cols-3">
                        {selectedTemporalIndices.map((index) => {
                          const stat = temporalStats[index];
                          if (!stat) return null;
                          const sign = stat.delta >= 0 ? "+" : "";
                          const pctSign = stat.percentageDelta === null || stat.percentageDelta >= 0 ? "+" : "";
                          return (
                            <div key={`trend-stat-${index}`} className="rounded-xl border border-white/10 bg-black/10 p-4">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-semibold text-gray-200">{index}</p>
                                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-gray-400">
                                  {stat.delta >= 0 ? "Increasing" : "Decreasing"}
                                </span>
                              </div>
                              <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                                <div><p className="text-gray-600">First year</p><p className="mt-1 text-gray-300">{stat.firstYear}: {stat.first.toFixed(4)}</p></div>
                                <div><p className="text-gray-600">Last year</p><p className="mt-1 text-gray-300">{stat.lastYear}: {stat.last.toFixed(4)}</p></div>
                                <div><p className="text-gray-600">Change</p><p className="mt-1 text-gray-300">{sign}{stat.delta.toFixed(4)}</p></div>
                                <div><p className="text-gray-600">% indicator change</p><p className="mt-1 text-gray-300">{stat.percentageDelta === null ? "—" : `${pctSign}${stat.percentageDelta.toFixed(2)} pp`}</p></div>
                              </div>
                              <p className="mt-4 text-[11px] text-gray-500">
                                Highest: {stat.highestYear} · Lowest: {stat.lowestYear}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* =================================================
                        PHASE 8G — TIMELINE + CHARTS
                        ================================================= */}
                    <div className="mt-6 rounded-2xl border border-blue-400/20 bg-blue-500/[0.025] p-5">
                      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                        <div>
                          <p className="text-xs uppercase tracking-[0.25em] text-blue-300">
                            Timeline + Charts
                          </p>
                          <h4 className="mt-1 text-xl font-semibold text-white">
                            Multi-Year Temporal Visualization
                          </h4>
                          <p className="mt-2 text-xs leading-5 text-gray-500">
                            Multi-year index trends.
                          </p>
                        </div>
                        <span className="w-fit rounded-full border border-blue-300/20 bg-blue-300/10 px-3 py-1 text-[10px] uppercase tracking-wider text-blue-200">
                          {temporalRows.length} YEAR TIMELINE
                        </span>
                      </div>

                      <div className="mt-6 grid gap-3 md:grid-cols-4">
                        {temporalRows.map((row, index) => (
                          <div key={`timeline-${row.analysis_year}`} className="relative rounded-xl border border-white/10 bg-black/20 p-4">
                            {index < temporalRows.length - 1 && (
                              <div className="absolute left-full top-1/2 hidden h-px w-3 bg-blue-400/30 md:block" />
                            )}
                            <p className="text-lg font-semibold text-blue-200">{row.analysis_year}</p>
                            <p className="mt-1 text-[11px] text-gray-500">{row.date || "Date unavailable"}</p>
                            <div className="mt-3 space-y-1 text-[11px] text-gray-400">
                              {selectedTemporalIndices.map((indexName) => {
                                const value = getTemporalMetric(row, indexName);
                                return (
                                  <div key={`${row.analysis_year}-${indexName}`} className="flex justify-between gap-2">
                                    <span>{indexName}</span>
                                    <span className="text-gray-300">{value === null ? "—" : value.toFixed(4)}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-6 grid gap-4 lg:grid-cols-3">
                        {selectedTemporalIndices.map(renderTemporalChart)}
                      </div>

                      <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-5">
                        <div>
                          <p className="text-sm font-semibold text-gray-200">First Year vs Last Year</p>
                          <p className="mt-1 text-[11px] text-gray-500">Comparison of mean index values across the selected temporal range.</p>
                        </div>

                        <div className="mt-6 grid gap-5 md:grid-cols-3">
                          {selectedTemporalIndices.map((index) => {
                            const stat = temporalStats[index];
                            if (!stat) return null;
                            const maxAbs = Math.max(Math.abs(stat.first), Math.abs(stat.last), 0.0001);
                            const firstWidth = Math.min(100, Math.abs(stat.first) / maxAbs * 100);
                            const lastWidth = Math.min(100, Math.abs(stat.last) / maxAbs * 100);
                            return (
                              <div key={`comparison-${index}`} className="rounded-xl border border-white/10 bg-[#050912] p-4">
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-semibold text-gray-200">{index}</span>
                                  <span className="text-[10px] text-gray-500">{stat.firstYear} → {stat.lastYear}</span>
                                </div>
                                <div className="mt-4 space-y-3">
                                  <div>
                                    <div className="mb-1 flex justify-between text-[10px] text-gray-500"><span>First</span><span>{stat.first.toFixed(4)}</span></div>
                                    <div className="h-2 rounded-full bg-white/5"><div className="h-2 rounded-full bg-blue-400/70" style={{ width: `${firstWidth}%` }} /></div>
                                  </div>
                                  <div>
                                    <div className="mb-1 flex justify-between text-[10px] text-gray-500"><span>Last</span><span>{stat.last.toFixed(4)}</span></div>
                                    <div className="h-2 rounded-full bg-white/5"><div className="h-2 rounded-full bg-blue-400/70" style={{ width: `${lastWidth}%` }} /></div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>


                    {/* =================================================
                        PHASE 8H — TEMPORAL SUMMARY
                        ================================================= */}
                    <div className="mt-6 rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.025] p-5">
                      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                        <div>
                          <p className="text-xs uppercase tracking-[0.25em] text-emerald-300">
                            Temporal Summary
                          </p>
                          <h4 className="mt-1 text-xl font-semibold text-white">
                            Multi-Year Temporal Summary
                          </h4>
                          <p className="mt-2 text-xs leading-5 text-gray-500">
                            Summary of observed index movement.
                          </p>
                        </div>
                        <span className="w-fit rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-[10px] uppercase tracking-wider text-emerald-200">
                          {temporalRows.length} YEARS ANALYZED
                        </span>
                      </div>

                      <div className="mt-5 grid gap-4 lg:grid-cols-3">
                        {selectedTemporalIndices.map((index) => {
                          const stat = temporalSummaryStats[index];
                          if (!stat) return null;

                          const directionClass =
                            stat.direction === "Increasing"
                              ? "text-emerald-300 border-emerald-400/20 bg-emerald-400/10"
                              : stat.direction === "Decreasing"
                                ? "text-amber-300 border-amber-400/20 bg-amber-400/10"
                                : "text-gray-300 border-white/10 bg-white/5";

                          const changeSign = stat.delta > 0 ? "+" : "";

                          return (
                            <div
                              key={`temporal-summary-${index}`}
                              className="rounded-xl border border-white/10 bg-black/20 p-4"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-semibold text-gray-200">
                                  {index}
                                </p>
                                <span
                                  className={`rounded-full border px-2.5 py-1 text-[10px] ${directionClass}`}
                                >
                                  {stat.direction}
                                </span>
                              </div>

                              <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                                <div>
                                  <p className="text-gray-600">First</p>
                                  <p className="mt-1 text-gray-300">
                                    {stat.firstYear}: {stat.first.toFixed(4)}
                                  </p>
                                </div>

                                <div>
                                  <p className="text-gray-600">Last</p>
                                  <p className="mt-1 text-gray-300">
                                    {stat.lastYear}: {stat.last.toFixed(4)}
                                  </p>
                                </div>

                                <div>
                                  <p className="text-gray-600">Change</p>
                                  <p className="mt-1 text-gray-300">
                                    {changeSign}{stat.delta.toFixed(4)}
                                  </p>
                                </div>

                                <div>
                                  <p className="text-gray-600">Indicator change</p>
                                  <p className="mt-1 text-gray-300">
                                    {stat.percentageDelta === null
                                      ? "—"
                                      : `${stat.percentageDelta > 0 ? "+" : ""}${stat.percentageDelta.toFixed(2)} pp`}
                                  </p>
                                </div>
                              </div>

                              <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2">
                                <p className="text-[10px] uppercase tracking-wider text-gray-600">
                                  Range
                                </p>
                                <p className="mt-1 text-xs text-gray-400">
                                  Highest: <span className="text-gray-300">{stat.highestYear}</span>
                                  {" · "}
                                  Lowest: <span className="text-gray-300">{stat.lowestYear}</span>
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="mt-5 rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.04] p-5">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs uppercase tracking-[0.2em] text-emerald-300">
                              Overall Temporal Observation
                            </p>
                            <p className="mt-1 text-[11px] text-gray-500">
                              Based only on the first-to-last movement of the selected index means.
                            </p>
                          </div>
                          <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[10px] text-gray-500">
                            DATA-BASED
                          </span>
                        </div>

                        <p className="mt-4 text-sm leading-6 text-gray-200">
                          {overallTemporalObservation}
                        </p>

                        <p className="mt-3 text-[11px] leading-5 text-gray-600">
                          Based on observed index values.
                        </p>
                      </div>
                    </div>

                  </>
                )}
              </>
            )}
          </div>
        </section>
        </RevealSection>

        {/* =================================================
            PHASE 9A — EVIDENCE COLLECTION
            ================================================= */}
        {phase9EvidenceCount > 0 && (
          <RevealSection>
          <section className="mb-8 rounded-3xl border border-blue-400/20 bg-blue-500/[0.025] p-6 shadow-2xl">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-blue-300">
                  Evidence Collection
                </p>
                <h3 className="mt-1 text-2xl font-semibold text-white">
                  Satellite Evidence Layer
                </h3>
                <p className="mt-2 text-xs leading-5 text-gray-500">
                  Image, spectral, change and temporal results.
                </p>
              </div>
              <span className="w-fit rounded-full border border-blue-300/20 bg-blue-300/10 px-3 py-1 text-[10px] uppercase tracking-wider text-blue-200">
                {phase9EvidenceCount}/7 SOURCES READY
              </span>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Image + AOI", phase9Evidence.image && phase9Evidence.aoi],
                ["NDVI", phase9Evidence.ndvi.mean !== null],
                ["NDWI", phase9Evidence.ndwi.mean !== null],
                ["NDBI", phase9Evidence.ndbi.mean !== null],
                ["Land Intelligence", phase9Evidence.combinedLand],
                ["Change Detection", phase9Evidence.change],
                ["Temporal Analysis", phase9Evidence.temporal],
              ].map(([label, ready]) => (
                <div
                  key={`phase9-${label}`}
                  className="rounded-xl border border-white/10 bg-black/20 px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-400">{label}</span>
                    <span
                      className={`rounded-full px-2 py-1 text-[10px] ${
                        ready
                          ? "bg-emerald-400/10 text-emerald-300"
                          : "bg-white/5 text-gray-600"
                      }`}
                    >
                      {ready ? "READY" : "WAITING"}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {["NDVI", "NDWI", "NDBI"].map((index) => {
                const evidence = phase9Evidence[index.toLowerCase()];
                return (
                  <div
                    key={`phase9-index-${index}`}
                    className="rounded-xl border border-white/10 bg-black/20 p-4"
                  >
                    <p className="text-sm font-semibold text-gray-200">{index}</p>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <p className="text-gray-600">Mean</p>
                        <p className="mt-1 text-gray-300">
                          {evidence.mean === null ? "—" : evidence.mean.toFixed(4)}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-600">Indicator</p>
                        <p className="mt-1 text-gray-300">
                          {evidence.percentage === null
                            ? "—"
                            : `${evidence.percentage.toFixed(2)}%`}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {phase9Evidence.temporal && (
              <div className="mt-4 rounded-xl border border-blue-400/15 bg-blue-400/[0.035] p-4">
                <p className="text-[10px] uppercase tracking-wider text-blue-300">
                  Temporal Evidence
                </p>
                <p className="mt-2 text-sm leading-6 text-gray-300">
                  {overallTemporalObservation}
                </p>
              </div>
            )}

            <div className="mt-4 rounded-xl border border-blue-400/15 bg-blue-400/[0.035] px-4 py-3">
              <p className="text-[10px] uppercase tracking-wider text-blue-300">
                Evidence Status
              </p>
              <p className="mt-1 text-xs leading-5 text-gray-400">
                Evidence collected from completed analyses.
              </p>
            </div>
          </section>
          </RevealSection>
        )}

        {/* =================================================
            PHASE 9B — DETERMINISTIC SATELLITE INTELLIGENCE
            ================================================= */}
        {phase9EvidenceCount > 0 && (
          <RevealSection>
          <section className="mb-8 rounded-3xl border border-blue-400/20 bg-blue-500/[0.025] p-6 shadow-2xl">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-blue-300">
                  Satellite Intelligence
                </p>
                <h3 className="mt-1 text-2xl font-semibold text-white">
                  Satellite Intelligence Layer
                </h3>
                <p className="mt-2 text-xs leading-5 text-gray-500">
                  Combined observations from completed analyses.
                </p>
              </div>
              <span className="w-fit rounded-full border border-blue-300/20 bg-blue-300/10 px-3 py-1 text-[10px] uppercase tracking-wider text-blue-200">
                TOKEN-FREE
              </span>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {phase9IndexFindings.map((item) => (
                <div
                  key={`phase9b-${item.index}`}
                  className="rounded-xl border border-white/10 bg-black/20 p-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-200">
                      {item.index}
                    </p>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-gray-500">
                      EVIDENCE
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-gray-600">Mean</p>
                      <p className="mt-1 text-gray-300">
                        {item.evidence.mean === null
                          ? "—"
                          : item.evidence.mean.toFixed(4)}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-600">Indicator</p>
                      <p className="mt-1 text-gray-300">
                        {item.evidence.percentage === null
                          ? "—"
                          : `${item.evidence.percentage.toFixed(2)}%`}
                      </p>
                    </div>
                  </div>

                  <p className="mt-4 text-xs leading-5 text-blue-200">
                    {item.signal}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <p className="text-[10px] uppercase tracking-wider text-gray-500">
                  Land Intelligence
                </p>
                <p className="mt-2 text-sm leading-6 text-gray-300">
                  {phase9LandObservation}
                </p>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <p className="text-[10px] uppercase tracking-wider text-gray-500">
                  Temporal Evidence
                </p>
                <p className="mt-2 text-sm leading-6 text-gray-300">
                  {phase9Evidence.temporal
                    ? overallTemporalObservation
                    : "No temporal evidence is available yet."}
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-blue-400/15 bg-blue-400/[0.035] p-4">
              <p className="text-[10px] uppercase tracking-wider text-blue-300">
                Change Evidence
              </p>
              <p className="mt-2 text-sm leading-6 text-gray-300">
                {phase9Evidence.change
                  ? phase9ChangeObservation
                  : "No multispectral change evidence is available yet."}
              </p>
            </div>

            <div className="mt-4 rounded-xl border border-blue-400/15 bg-blue-400/[0.035] px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] uppercase tracking-wider text-blue-300">
                  Overall Satellite Observation
                </p>
                <span className="text-[10px] text-blue-300">
                  DATA-BASED
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-gray-200">
                {phase9BOverallObservation}
              </p>
              <p className="mt-3 text-[11px] leading-5 text-gray-500">
                Based on observed measurements.
              </p>
            </div>
          </section>
          </RevealSection>
        )}

        {/* =================================================
            PHASE 9D — EVIDENCE EXPLANATION
            ================================================= */}
        {phase9EvidenceCount > 0 && (
          <RevealSection>
          <section className="mb-8 rounded-3xl border border-blue-400/20 bg-blue-500/[0.02] p-6 shadow-2xl">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-blue-300">
                  Evidence Explanation
                </p>
                <h3 className="mt-1 text-2xl font-semibold text-white">
                  Why This Observation?
                </h3>
                <p className="mt-2 text-xs leading-5 text-gray-500">
                  Supporting evidence for each observation.
                </p>
              </div>
              <span className="w-fit rounded-full border border-blue-300/20 bg-blue-300/10 px-3 py-1 text-[10px] uppercase tracking-wider text-blue-200">
                {phase9DExplanationCount} SOURCES EXPLAINED
              </span>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {phase9DEvidenceItems.map((item) => (
                <div
                  key={`phase9d-${item.key}`}
                  className={`rounded-xl border p-4 ${
                    item.available
                      ? "border-white/10 bg-black/20"
                      : "border-white/5 bg-black/10 opacity-60"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-200">
                        {item.title}
                      </p>
                      <p className="mt-1 text-[10px] uppercase tracking-wider text-blue-300">
                        Source · {item.source}
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-2 py-1 text-[10px] ${
                        item.available
                          ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-200"
                          : "border-white/10 bg-white/5 text-gray-500"
                      }`}
                    >
                      {item.available ? "AVAILABLE" : "WAITING"}
                    </span>
                  </div>

                  <p className="mt-4 text-sm leading-6 text-gray-300">
                    {item.detail}
                  </p>

                  <div className="mt-3 rounded-lg border border-blue-400/10 bg-blue-400/[0.025] px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-gray-500">
                      Evidence interpretation
                    </p>
                    <p className="mt-1 text-xs leading-5 text-blue-100/80">
                      {item.interpretation}
                    </p>
                  </div>
                </div>
              ))}
            </div>

          </section>
          </RevealSection>
        )}

          </>
        )}

        </>

        {hasAnalysisContext && (
          <>
        <RevealSection>
        {/* INFO CARDS */}
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <InfoCard
            icon="🛰️"
            title="Satellite Image"
            value={fileName || "Not uploaded"}
          />

          <InfoCard
            icon="💾"
            title="File Size"
            value={fileSize || "—"}
          />

          <InfoCard
            icon="🔍"
            title="Format / Size"
            value={dimensions || "—"}
          />
        </div>
        {renderMultispectralChange()}
        </RevealSection>
          </>
        )}

      </main>
    </div>
  );
}

// =========================================================
// SCROLL REVEAL
// =========================================================

function RevealSection({ children, className = "" }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setVisible(entry.isIntersecting);
      },
      { threshold: 0.12, rootMargin: "0px 0px -60px 0px" }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`${className} transition-all duration-700 ease-out ${
        visible ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
      }`}
    >
      {children}
    </div>
  );
}

// =========================================================
// METRIC CARD
// =========================================================

function MetricCard({
  label,
  value,
  suffix = "",
}) {
  const numericValue =
    value !== null &&
    value !== undefined &&
    value !== ""
      ? Number(value)
      : null;

  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <p className="text-[10px] uppercase tracking-wider text-gray-500">
        {label}
      </p>

      <p className="mt-1 text-sm font-semibold text-gray-200">
        {numericValue !== null &&
        Number.isFinite(numericValue)
          ? `${numericValue.toFixed(2)}${suffix}`
          : "—"}
      </p>
    </div>
  );
}

// =========================================================
// STATUS CARD
// =========================================================

function StatusCard({
  label,
  value,
}) {
  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-gray-500">
        {label}
      </p>

      <p className="mt-1 text-sm font-medium text-gray-200">
        {value}
      </p>
    </div>
  );
}

// =========================================================
// INFO CARD
// =========================================================

function InfoCard({
  icon,
  title,
  value,
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <span className="text-xl">
          {icon}
        </span>

        <p className="text-xs uppercase tracking-wider text-gray-500">
          {title}
        </p>
      </div>

      <p className="mt-3 truncate text-lg font-medium">
        {value}
      </p>
    </div>
  );
}
