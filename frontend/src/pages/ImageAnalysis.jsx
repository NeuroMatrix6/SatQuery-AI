import { useEffect, useState } from "react";
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

  // =========================================================
  // PHASE 8A — MULTI-TEMPORAL SCENE RETRIEVAL
  // =========================================================
  const [multiTemporalScenes, setMultiTemporalScenes] = useState([]);
  const [multiTemporalError, setMultiTemporalError] = useState("");
  const [isMultiTemporalLoading, setIsMultiTemporalLoading] = useState(false);

  const [multiTemporalStartYear, setMultiTemporalStartYear] = useState("2022");
  const [multiTemporalEndYear, setMultiTemporalEndYear] = useState("2026");
  const [multiTemporalMonth, setMultiTemporalMonth] = useState("1");
  const [multiTemporalDay, setMultiTemporalDay] = useState("1");
  const [multiTemporalWindowDays, setMultiTemporalWindowDays] = useState("30");
  const [multiTemporalCloudCover, setMultiTemporalCloudCover] = useState("30");

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
    sessionStorage.removeItem("satquery_multi_temporal_scenes");
  };

  // =========================================================
  // COMBINED AI + NDVI + NDWI + NDBI ANALYSIS
  // =========================================================

  // =========================================================
  // PHASE 8A — MULTI-TEMPORAL SCENE RETRIEVAL
  // =========================================================

  const retrieveMultiTemporalScenes = async () => {
    setMultiTemporalError("");

    if (!activeAreaBounds) {
      setMultiTemporalError(
        "Please select an Analysis Area (AOI) in GeoLocation first."
      );
      return;
    }

    const startYear = Number(multiTemporalStartYear);
    const endYear = Number(multiTemporalEndYear);
    const targetMonth = Number(multiTemporalMonth);
    const targetDay = Number(multiTemporalDay);
    const windowDays = Number(multiTemporalWindowDays);
    const maxCloudCover = Number(multiTemporalCloudCover);

    if (
      !Number.isInteger(startYear) ||
      !Number.isInteger(endYear) ||
      startYear < 2015 ||
      endYear < 2015 ||
      endYear < startYear
    ) {
      setMultiTemporalError(
        "Enter valid years from 2015 onward, with End Year greater than or equal to Start Year."
      );
      return;
    }

    if (endYear - startYear > 10) {
      setMultiTemporalError("Phase 8A supports a maximum 10-year analysis span.");
      return;
    }

    if (
      !Number.isInteger(targetMonth) ||
      targetMonth < 1 ||
      targetMonth > 12
    ) {
      setMultiTemporalError("Target month must be between 1 and 12.");
      return;
    }

    if (
      !Number.isInteger(targetDay) ||
      targetDay < 1 ||
      targetDay > 31
    ) {
      setMultiTemporalError("Target day must be between 1 and 31.");
      return;
    }

    if (
      !Number.isInteger(windowDays) ||
      windowDays < 0 ||
      windowDays > 180
    ) {
      setMultiTemporalError("Search window must be between 0 and 180 days.");
      return;
    }

    if (
      !Number.isFinite(maxCloudCover) ||
      maxCloudCover < 0 ||
      maxCloudCover > 100
    ) {
      setMultiTemporalError("Maximum cloud cover must be between 0 and 100%.");
      return;
    }

    const firstCorner = activeAreaBounds?.[0];
    const secondCorner = activeAreaBounds?.[1];

    if (
      !Array.isArray(firstCorner) ||
      !Array.isArray(secondCorner) ||
      firstCorner.length < 2 ||
      secondCorner.length < 2
    ) {
      setMultiTemporalError("The selected AOI bounds are invalid.");
      return;
    }

    const south = Math.min(Number(firstCorner[0]), Number(secondCorner[0]));
    const north = Math.max(Number(firstCorner[0]), Number(secondCorner[0]));
    const west = Math.min(Number(firstCorner[1]), Number(secondCorner[1]));
    const east = Math.max(Number(firstCorner[1]), Number(secondCorner[1]));

    if (
      ![west, south, east, north].every(Number.isFinite) ||
      west >= east ||
      south >= north
    ) {
      setMultiTemporalError("The selected AOI coordinates are invalid.");
      return;
    }

    setIsMultiTemporalLoading(true);
    setMultiTemporalScenes([]);

    try {
      const apiBase =
        import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

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

      const response = await fetch(
        `${apiBase}/api/multi-temporal-scenes`,
        {
          method: "POST",
          body: form,
        }
      );

      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error("Phase 8A returned an invalid server response.");
      }

      if (!response.ok || !data?.success) {
        throw new Error(
          data?.error || "Multi-temporal satellite scene retrieval failed."
        );
      }

      const scenes = Array.isArray(data.scenes)
        ? [...data.scenes].sort(
            (a, b) =>
              Number(a?.analysis_year || 0) -
              Number(b?.analysis_year || 0)
          )
        : [];

      setMultiTemporalScenes(scenes);

      sessionStorage.setItem(
        "satquery_multi_temporal_scenes",
        JSON.stringify({
          phase: "8A",
          aoi: [west, south, east, north],
          query: data.query || {
            start_year: startYear,
            end_year: endYear,
            target_month: targetMonth,
            target_day: targetDay,
            window_days: windowDays,
            max_cloud_cover: maxCloudCover,
          },
          scenes,
          requested_years: data.requested_years || [],
          retrieved_years: data.retrieved_years || [],
          missing_years: data.missing_years || [],
          same_aoi: true,
        })
      );

      if (!scenes.length) {
        setMultiTemporalError(
          "No Sentinel-2 scenes matched the Phase 8A search criteria."
        );
      }
    } catch (err) {
      console.error("PHASE 8A MULTI-TEMPORAL RETRIEVAL ERROR:", err);
      setMultiTemporalError(
        err?.message ||
          "Unable to retrieve multi-temporal Sentinel-2 scenes."
      );
    } finally {
      setIsMultiTemporalLoading(false);
    }
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

      // Phase 6D — AI Land Insight
      const aiForm = new FormData();
      aiForm.append("mean_ndvi", String(meanNdvi));
      aiForm.append("vegetation_percentage", String(vegetationPercentage));
      aiForm.append("mean_ndwi", String(meanNdwi));
      aiForm.append("water_percentage", String(waterPercentage));
      aiForm.append("mean_ndbi", String(meanNdbi));
      aiForm.append("builtup_percentage", String(builtupPercentage));
      aiForm.append("dominant_type", dominantType);
      aiForm.append("dominant_percentage", String(dominantPercentage));
      aiForm.append("classification", classification);
      aiForm.append(
        "classified_total_percentage",
        String(classifiedTotalPercentage)
      );
      aiForm.append("other_percentage", String(otherPercentage));
      aiForm.append("overlap_detected", String(overlapDetected));

      const aiResponse = await fetch(
        `${apiBase}/api/combined-land-ai-insight`,
        { method: "POST", body: aiForm }
      );

      if (!aiResponse.ok) {
        throw new Error("Combined AI Land Insight request failed.");
      }

      const aiData = await aiResponse.json();

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
        ai_insight: aiData,
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
      // PHASE 6 — COMBINED LAND INTELLIGENCE
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

      const result = await askVQA({
        file: selectedFile,
        question: combinedQuestion,
      });

      setAnswer(result);
    } catch (err) {
      setError(
        err?.message ||
          "Unable to connect to the AI backend."
      );
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
  // UI
  // =========================================================


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
              Phase 7
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
              <div className="mt-5 rounded-2xl border border-purple-400/20 bg-purple-400/5 p-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-purple-300">
                    AI Change Insight
                  </p>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-gray-400">
                    {multispectralAiInsight.mode === "live"
                      ? "LIVE MODEL"
                      : "DEMO FALLBACK"}
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
        <div className="absolute right-[-100px] top-[35%] h-[500px] w-[500px] rounded-full bg-purple-600/10 blur-[170px]" />
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
            Upload satellite imagery and ask AI questions about
            buildings, roads, vegetation, water bodies, land use
            and other visible features.
          </p>
        </div>

        {/* =================================================
            PHASE 8A — MULTI-TEMPORAL ANALYSIS
            ================================================= */}

        <section className="mb-8 overflow-hidden rounded-3xl border border-cyan-400/20 bg-cyan-500/[0.035] shadow-2xl">
          <div className="border-b border-white/10 bg-cyan-500/[0.04] px-6 py-6">
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-cyan-400">
                  Phase 8A · Multi-Temporal Analysis
                </p>
                <h3 className="mt-2 text-2xl font-semibold">
                  Multi-Year Satellite Scenes
                </h3>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
                  Retrieve one representative Sentinel-2 scene for each year
                  over the same selected AOI. Phase 8A retrieves scene metadata
                  only; spectral analysis comes later.
                </p>
              </div>

              <span className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-wider ${
                isMultiTemporalLoading
                  ? "border-yellow-400/20 bg-yellow-400/10 text-yellow-400"
                  : multiTemporalScenes.length
                  ? "border-green-400/20 bg-green-400/10 text-green-400"
                  : "border-white/10 bg-white/5 text-gray-500"
              }`}>
                {isMultiTemporalLoading
                  ? "RETRIEVING"
                  : multiTemporalScenes.length
                  ? "SCENES READY"
                  : "READY"}
              </span>
            </div>
          </div>

          <div className="p-6">
            {!activeAreaBounds && (
              <div className="mb-5 rounded-2xl border border-yellow-400/20 bg-yellow-400/[0.05] p-4">
                <p className="text-sm font-medium text-yellow-300">
                  Select an Analysis Area first
                </p>
                <p className="mt-1 text-xs leading-5 text-gray-500">
                  Go to GeoLocation, select the AOI you want to study, then
                  open Image Analysis.
                </p>
              </div>
            )}

            {activeAreaBounds && (
              <div className="mb-5 rounded-2xl border border-cyan-400/15 bg-black/20 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-gray-500">
                      Active AOI
                    </p>
                    <p className="mt-1 text-sm text-gray-300">
                      The same selected area will be used for every requested
                      year.
                    </p>
                  </div>
                  <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[10px] text-cyan-300">
                    AOI LOCKED
                  </span>
                </div>

                <p className="mt-3 break-all text-xs text-gray-500">
                  {JSON.stringify(activeAreaBounds)}
                </p>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <TemporalInput
                label="Start Year"
                type="number"
                min="2015"
                value={multiTemporalStartYear}
                onChange={setMultiTemporalStartYear}
              />
              <TemporalInput
                label="End Year"
                type="number"
                min="2015"
                value={multiTemporalEndYear}
                onChange={setMultiTemporalEndYear}
              />
              <TemporalInput
                label="Target Month"
                type="number"
                min="1"
                max="12"
                value={multiTemporalMonth}
                onChange={setMultiTemporalMonth}
              />
              <TemporalInput
                label="Target Day"
                type="number"
                min="1"
                max="31"
                value={multiTemporalDay}
                onChange={setMultiTemporalDay}
              />
              <TemporalInput
                label="Search Window (± days)"
                type="number"
                min="0"
                max="180"
                value={multiTemporalWindowDays}
                onChange={setMultiTemporalWindowDays}
              />
              <TemporalInput
                label="Max Cloud Cover %"
                type="number"
                min="0"
                max="100"
                value={multiTemporalCloudCover}
                onChange={setMultiTemporalCloudCover}
              />
            </div>

            <div className="mt-5 flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={retrieveMultiTemporalScenes}
                disabled={!activeAreaBounds || isMultiTemporalLoading}
                className={`rounded-2xl px-8 py-3.5 text-sm font-semibold shadow-xl transition ${
                  activeAreaBounds && !isMultiTemporalLoading
                    ? "bg-cyan-500 text-black shadow-cyan-500/20 hover:scale-[1.02] hover:bg-cyan-400"
                    : "cursor-not-allowed bg-gray-700 text-gray-500"
                }`}
              >
                {isMultiTemporalLoading ? (
                  <>
                    <span className="mr-2 inline-block animate-spin">◌</span>
                    Retrieving Year-wise Scenes...
                  </>
                ) : (
                  <>🛰️ Retrieve Multi-Year Scenes</>
                )}
              </button>

              <p className="text-[11px] text-gray-600">
                Default study period: 2022 → 2026
              </p>
            </div>

            {multiTemporalError && (
              <div className="mt-5 rounded-2xl border border-red-400/20 bg-red-500/[0.05] p-4">
                <p className="text-sm leading-6 text-red-300">
                  {multiTemporalError}
                </p>
              </div>
            )}

            {multiTemporalScenes.length > 0 && (
              <div className="mt-6">
                <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-cyan-400">
                      Retrieved Scenes
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      One representative Sentinel-2 scene for each available
                      year.
                    </p>
                  </div>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] text-gray-400">
                    {multiTemporalScenes.length} YEAR
                    {multiTemporalScenes.length === 1 ? "" : "S"} FOUND
                  </span>
                </div>

                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {multiTemporalScenes.map((scene, index) => (
                    <div
                      key={`${scene?.analysis_year || "year"}-${scene?.id || index}`}
                      className="rounded-2xl border border-white/10 bg-black/20 p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-lg font-semibold text-cyan-300">
                          {scene?.analysis_year || "—"}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-gray-400">
                          Sentinel-2
                        </span>
                      </div>

                      <div className="mt-4 space-y-2 text-xs">
                        <div>
                          <span className="text-gray-600">Acquisition</span>
                          <p className="mt-0.5 text-gray-300">
                            {scene?.acquisition_date
                              ? String(scene.acquisition_date).slice(0, 10)
                              : "Unavailable"}
                          </p>
                        </div>
                        <div>
                          <span className="text-gray-600">Cloud Cover</span>
                          <p className="mt-0.5 text-gray-300">
                            {scene?.cloud_cover !== null &&
                            scene?.cloud_cover !== undefined
                              ? `${Number(scene.cloud_cover).toFixed(2)}%`
                              : "Unavailable"}
                          </p>
                        </div>
                        <div>
                          <span className="text-gray-600">Scene ID</span>
                          <p className="mt-0.5 break-all text-gray-400">
                            {scene?.id || "Unavailable"}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* WORKSPACE */}
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
                        This raster format is accepted by the AI
                        pipeline but is not natively previewed
                        by most browsers.
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

          {/* AI PANEL */}
          <div className="rounded-3xl border border-blue-500/20 bg-gradient-to-b from-blue-500/[0.08] to-transparent p-6 backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/15 text-xl">
                ✦
              </div>

              <div>
                <h3 className="font-semibold">
                  Ask AI
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
                  AI STATUS
                </span>

                <span className="flex items-center gap-2 text-xs text-green-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                  READY
                </span>
              </div>

              <p className="mt-3 text-sm leading-6 text-gray-400">
                {previewUrl
                  ? activeScene
                    ? "Sentinel-2 image ready. Analyze to run AI image understanding + NDVI + NDWI + NDBI for the selected AOI."
                    : "Your satellite image is ready. Analyze it with AI or ask a question."
                  : "Upload a satellite image first to enable AI analysis."}
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
                    ? "Ask anything about this satellite image..."
                    : "Upload a satellite image first..."
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
                  ? "Analyzing AI + NDVI + NDWI + NDBI..."
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
              <div className="mt-5 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.05] p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-cyan-400">
                    NDWI Analysis
                  </p>

                  <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[10px] text-cyan-300">
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
              <div className="mt-5 rounded-2xl border border-orange-400/20 bg-orange-400/[0.05] p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-orange-400">
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
                PHASE 6 — COMBINED LAND INTELLIGENCE
                ================================================= */}

            {combinedLandResult && (
              <div className="mt-6 rounded-2xl border border-violet-400/20 bg-violet-400/[0.05] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-violet-400">
                      Combined Land Intelligence
                    </p>
                    <p className="mt-1 text-[11px] text-gray-500">
                      NDVI + NDWI + NDBI • Same Sentinel-2 AOI
                    </p>
                  </div>
                  <span className="rounded-full border border-violet-400/20 bg-violet-400/10 px-2 py-1 text-[10px] text-violet-300">
                    PHASE 6
                  </span>
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
                      <span className="text-sm font-semibold text-violet-300">
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
                        AI Land Insight
                      </p>
                      <span className="text-[10px] text-gray-500">
                        {combinedLandResult.ai_insight.mode === "live"
                          ? "LIVE MODEL"
                          : "DEMO FALLBACK"}
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
              <div className="mt-5 rounded-xl border border-violet-400/20 bg-violet-400/[0.05] p-3 text-xs text-violet-300">
                Combining NDVI + NDWI + NDBI and generating AI land insight...
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
                    {answer.provider ===
                    "huggingface"
                      ? "LIVE MODEL"
                      : "DEMO FALLBACK"}
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

      </main>
    </div>
  );
}

// =========================================================
// PHASE 8A TEMPORAL INPUT
// =========================================================

function TemporalInput({
  label,
  type = "text",
  min,
  max,
  value,
  onChange,
}) {
  return (
    <div>
      <label className="mb-2 block text-xs uppercase tracking-wider text-gray-500">
        {label}
      </label>
      <input
        type={type}
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500/50"
      />
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