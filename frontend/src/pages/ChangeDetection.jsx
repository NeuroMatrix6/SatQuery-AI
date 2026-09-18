import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { analyzeNDVI, analyzeNDWI, analyzeNDBI } from "../services/ai";

const API_BASE = "https://satquery-ai-backend-r165.onrender.com";

const DEMO_PAIR = {
  before: {
    name: "before-2025.jpg",
    path: "/demo/before-2025.jpg",
    type: "image/jpeg",
    date: "2025-09-01",
  },

  after: {
    name: "after-2026.jpg",
    path: "/demo/after-2026.jpg",
    type: "image/jpeg",
    date: "2026-09-01",
  },
};

export default function ChangeDetection() {
  const navigate = useNavigate();
const [beforeImage, setBeforeImage] = useState(null);

const [afterImage, setAfterImage] = useState(null);

const [beforeName, setBeforeName] = useState("");

const [afterName, setAfterName] = useState("");

const [beforeDate, setBeforeDate] = useState("");

const [afterDate, setAfterDate] = useState("");

const [beforeScene, setBeforeScene] = useState(null);

const [afterScene, setAfterScene] = useState(null);

const [result, setResult] = useState(null);

const [isComparing, setIsComparing] = useState(false);

const [isAiInterpreting, setIsAiInterpreting] = useState(false);

const [aiInterpretation, setAiInterpretation] = useState(null);

const [aiError, setAiError] = useState("");

/* =========================================================
   PHASE 7 — MULTISPECTRAL CHANGE STATE
========================================================= */

const [multispectralChangeResult, setMultispectralChangeResult] =
  useState(null);

const [isMultispectralChangeAnalyzing, setIsMultispectralChangeAnalyzing] =
  useState(false);

const [multispectralAiInsight, setMultispectralAiInsight] =
  useState(null);

const [multispectralChangeError, setMultispectralChangeError] =
  useState("");

const canvasRef = useRef(null);
// =========================================================
// LOAD GEOLOCATION CHANGE-DETECTION SCENES
// =========================================================

useEffect(() => {
  const beforeSaved = sessionStorage.getItem(
    "satquery_change_before"
  );

  const afterSaved = sessionStorage.getItem(
    "satquery_change_after"
  );

  if (!beforeSaved && !afterSaved) {
    return;
  }

  let cancelled = false;

  const loadScene = async (savedData, type) => {
    if (!savedData) {
      return;
    }

    try {
      const parsed = JSON.parse(savedData);

      if (!parsed.previewImage) {
        return;
      }

      const response = await fetch(
        parsed.previewImage
      );

      if (!response.ok) {
        throw new Error(
          `Unable to load ${type} Sentinel-2 scene.`
        );
      }

      const blob = await response.blob();

      const sceneDate =
        parsed.scene?.acquisition_date || "";

      const sceneName =
        parsed.scene?.product_name ||
        parsed.scene?.id ||
        `Sentinel-2 ${type} scene`;

      if (cancelled) {
        return;
      }

      const imageUrl =
        URL.createObjectURL(blob);

      if (type === "before") {
        setBeforeImage(imageUrl);
        setBeforeName(sceneName);
        setBeforeDate(
          sceneDate
            ? sceneDate.slice(0, 10)
            : ""
        );
        setBeforeScene(parsed);
      }

      if (type === "after") {
        setAfterImage(imageUrl);
        setAfterName(sceneName);
        setAfterDate(
          sceneDate
            ? sceneDate.slice(0, 10)
            : ""
        );
        setAfterScene(parsed);
      }

    } catch (error) {
      console.error(
        `Failed to load ${type} Sentinel-2 scene:`,
        error
      );

      if (!cancelled) {
        setAiError(
          error?.message ||
            `Unable to load ${type} Sentinel-2 scene.`
        );
      }
    }
  };

  const loadScenes = async () => {
    await Promise.all([
      loadScene(
        beforeSaved,
        "before"
      ),
      loadScene(
        afterSaved,
        "after"
      ),
    ]);

    if (!cancelled) {
      sessionStorage.removeItem(
        "satquery_change_before"
      );

      sessionStorage.removeItem(
        "satquery_change_after"
      );
    }
  };

  loadScenes();

  return () => {
    cancelled = true;
  };
}, []);
  // =========================================================
  // IMAGE UPLOAD
  // =========================================================

  const handleUpload = (event, type) => {
    const file = event.target.files?.[0];

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Please upload a valid image.");
      return;
    }

    const imageURL = URL.createObjectURL(file);

    if (type === "before") {
      if (beforeImage) {
        URL.revokeObjectURL(beforeImage);
      }

      setBeforeImage(imageURL);
      setBeforeName(file.name);

      setResult(null);
      setAiInterpretation(null);
      setAiError("");
      setMultispectralChangeResult(null);
      setMultispectralAiInsight(null);
      setMultispectralChangeError("");
    }

    if (type === "after") {
      if (afterImage) {
        URL.revokeObjectURL(afterImage);
      }

      setAfterImage(imageURL);
      setAfterName(file.name);

      setResult(null);
      setAiInterpretation(null);
      setAiError("");
      setMultispectralChangeResult(null);
      setMultispectralAiInsight(null);
      setMultispectralChangeError("");
    }

    event.target.value = "";
  };

  // =========================================================
  // LOAD DEMO PAIR
  // =========================================================

  const loadDemoPair = async () => {
    try {
      setResult(null);
      setAiInterpretation(null);
      setAiError("");
      setMultispectralChangeResult(null);
      setMultispectralAiInsight(null);
      setMultispectralChangeError("");

      const [beforeResponse, afterResponse] = await Promise.all([
        fetch(DEMO_PAIR.before.path),
        fetch(DEMO_PAIR.after.path),
      ]);

      if (!beforeResponse.ok || !afterResponse.ok) {
        throw new Error(
          "Demo change-detection images could not be loaded."
        );
      }

      const [beforeBlob, afterBlob] = await Promise.all([
        beforeResponse.blob(),
        afterResponse.blob(),
      ]);

      const beforeFile = new File(
        [beforeBlob],
        DEMO_PAIR.before.name,
        {
          type: DEMO_PAIR.before.type,
        }
      );

      const afterFile = new File(
        [afterBlob],
        DEMO_PAIR.after.name,
        {
          type: DEMO_PAIR.after.type,
        }
      );

      const beforeUrl = URL.createObjectURL(beforeFile);
      const afterUrl = URL.createObjectURL(afterFile);

      if (beforeImage) {
        URL.revokeObjectURL(beforeImage);
      }

      if (afterImage) {
        URL.revokeObjectURL(afterImage);
      }

      setBeforeImage(beforeUrl);
      setAfterImage(afterUrl);

      setBeforeName(DEMO_PAIR.before.name);
      setAfterName(DEMO_PAIR.after.name);

      setBeforeDate(DEMO_PAIR.before.date);
      setAfterDate(DEMO_PAIR.after.date);
    } catch (error) {
      setAiError(
        error?.message || "Unable to load demo change-detection pair."
      );
    }
  };

  // =========================================================
  // REMOVE IMAGE
  // =========================================================

  const removeImage = (type) => {
    if (type === "before") {
      if (beforeImage) {
        URL.revokeObjectURL(beforeImage);
      }

      setBeforeImage(null);
      setBeforeName("");

      setResult(null);
      setAiInterpretation(null);
      setAiError("");
      setMultispectralChangeResult(null);
      setMultispectralAiInsight(null);
      setMultispectralChangeError("");
    }

    if (type === "after") {
      if (afterImage) {
        URL.revokeObjectURL(afterImage);
      }

      setAfterImage(null);
      setAfterName("");

      setResult(null);
      setAiInterpretation(null);
      setAiError("");
      setMultispectralChangeResult(null);
      setMultispectralAiInsight(null);
      setMultispectralChangeError("");
    }
  };

  // =========================================================
  // PHASE 7 — MULTISPECTRAL CHANGE DETECTION
  // =========================================================

  const analyzeMultispectralChange = async () => {
    if (!beforeScene || !afterScene) {
      return false;
    }

    const beforeSceneData = beforeScene.scene || beforeScene;
    const afterSceneData = afterScene.scene || afterScene;
    const beforeBounds = beforeScene.areaBounds || null;
    const afterBounds = afterScene.areaBounds || null;

    if (!beforeBounds || !afterBounds) {
      throw new Error(
        "Phase 7 requires the same AOI bounds for both Sentinel-2 scenes."
      );
    }

    if (JSON.stringify(beforeBounds) !== JSON.stringify(afterBounds)) {
      throw new Error(
        "Before and After scenes use different AOIs. Select both scenes from the same area before running multispectral change detection."
      );
    }

    setIsMultispectralChangeAnalyzing(true);
    setMultispectralChangeError("");
    setMultispectralChangeResult(null);
    setMultispectralAiInsight(null);

    try {
      // Run all three spectral analyses for the exact same AOI.
      const [beforeNdvi, afterNdvi, beforeNdwi, afterNdwi, beforeNdbi, afterNdbi] =
        await Promise.all([
          analyzeNDVI({ scene: beforeSceneData, areaBounds: beforeBounds }),
          analyzeNDVI({ scene: afterSceneData, areaBounds: afterBounds }),
          analyzeNDWI({ scene: beforeSceneData, areaBounds: beforeBounds }),
          analyzeNDWI({ scene: afterSceneData, areaBounds: afterBounds }),
          analyzeNDBI({ scene: beforeSceneData, areaBounds: beforeBounds }),
          analyzeNDBI({ scene: afterSceneData, areaBounds: afterBounds }),
        ]);

      const getNumber = (...values) => {
        for (const value of values) {
          const number = Number(value);
          if (Number.isFinite(number)) return number;
        }
        return null;
      };

      const getStats = (data) => data?.stats || data?.statistics || {};

      const bNv = getStats(beforeNdvi);
      const aNv = getStats(afterNdvi);
      const bNw = getStats(beforeNdwi);
      const aNw = getStats(afterNdwi);
      const bNb = getStats(beforeNdbi);
      const aNb = getStats(afterNdbi);

      const metricValues = {
        before_mean_ndvi: getNumber(bNv.mean, beforeNdvi?.mean_ndvi, beforeNdvi?.mean),
        after_mean_ndvi: getNumber(aNv.mean, afterNdvi?.mean_ndvi, afterNdvi?.mean),
        before_vegetation_percentage: getNumber(bNv.vegetation_percentage, beforeNdvi?.vegetation_percentage, beforeNdvi?.vegetation_percent),
        after_vegetation_percentage: getNumber(aNv.vegetation_percentage, afterNdvi?.vegetation_percentage, afterNdvi?.vegetation_percent),
        before_mean_ndwi: getNumber(bNw.mean, beforeNdwi?.mean_ndwi, beforeNdwi?.mean),
        after_mean_ndwi: getNumber(aNw.mean, afterNdwi?.mean_ndwi, afterNdwi?.mean),
        before_water_percentage: getNumber(bNw.water_percentage, beforeNdwi?.water_percentage, beforeNdwi?.water_percent),
        after_water_percentage: getNumber(aNw.water_percentage, afterNdwi?.water_percentage, afterNdwi?.water_percent),
        before_mean_ndbi: getNumber(bNb.mean, beforeNdbi?.mean_ndbi, beforeNdbi?.mean),
        after_mean_ndbi: getNumber(aNb.mean, afterNdbi?.mean_ndbi, afterNdbi?.mean),
        before_builtup_percentage: getNumber(bNb.builtup_percentage, beforeNdbi?.builtup_percentage, beforeNdbi?.builtup_percent),
        after_builtup_percentage: getNumber(aNb.builtup_percentage, afterNdbi?.builtup_percentage, afterNdbi?.builtup_percent),
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

      const response = await fetch(`${API_BASE}/api/multispectral-change-detection`, {
        method: "POST",
        body: form,
      });

      const data = await response.json();
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Multispectral change detection failed.");
      }

      setMultispectralChangeResult(data);

      const aiForm = new FormData();
      Object.entries(metricValues).forEach(([key, value]) => {
        aiForm.append(key, String(value));
      });
      aiForm.append("change_summary", data?.interpretation?.summary || "");

      const aiResponse = await fetch(`${API_BASE}/api/multispectral-change-ai-insight`, {
        method: "POST",
        body: aiForm,
      });

      const aiData = await aiResponse.json();
      if (!aiResponse.ok || !aiData?.success) {
        throw new Error(aiData?.error || "Multispectral AI insight failed.");
      }

      setMultispectralAiInsight(aiData);
      return true;
    } catch (error) {
      console.error("MULTISPECTRAL CHANGE ERROR:", error);
      setMultispectralChangeError(
        error?.message || "Unable to calculate multispectral change."
      );
      return false;
    } finally {
      setIsMultispectralChangeAnalyzing(false);
    }
  };

  // =========================================================
  // CHANGE DETECTION
  // =========================================================

  const compareImages = async () => {
    if (!beforeImage || !afterImage) {
      alert("Please upload both images first.");
      return;
    }

    setIsComparing(true);
    setAiInterpretation(null);
    setAiError("");
    setResult(null);

    let changeDetectionSucceeded = false;

    try {
      // ------------------------------------------------------
      // Convert preview URLs back into image blobs
      // ------------------------------------------------------

      const beforeResponse = await fetch(beforeImage);
      const afterResponse = await fetch(afterImage);

      if (!beforeResponse.ok || !afterResponse.ok) {
        throw new Error("Unable to read uploaded images.");
      }

      const beforeBlob = await beforeResponse.blob();
      const afterBlob = await afterResponse.blob();

      // ------------------------------------------------------
      // 1. VISUAL CHANGE DETECTION
      // ------------------------------------------------------

      const formData = new FormData();

      formData.append(
        "before_image",
        beforeBlob,
        beforeName || "before.png"
      );

      formData.append(
        "after_image",
        afterBlob,
        afterName || "after.png"
      );

      formData.append("before_date", beforeDate || "");
      formData.append("after_date", afterDate || "");

      const changeResponse = await fetch(
        "https://satquery-ai-backend-r165.onrender.com/api/change-detection",
        {
          method: "POST",
          body: formData,
        }
      );

      const changeData = await changeResponse.json();

      console.log(
        "CHANGE DETECTION RESPONSE:",
        changeData
      );

      if (!changeResponse.ok || !changeData.success) {
        throw new Error(
          changeData.error ||
            "Change detection failed."
        );
      }

      // Show result immediately
      setResult({
        percentage: changeData.overall_change,
        image: changeData.change_map,
        categories: changeData.categories,
        categoryPixels: changeData.category_pixels,
        beforeDate: changeData.before_date,
        afterDate: changeData.after_date,
      });

      changeDetectionSucceeded = true;

      // ------------------------------------------------------
      // 2. MULTISPECTRAL CHANGE DETECTION (PHASE 7)
      // ------------------------------------------------------
      // This runs only when both inputs came from Sentinel-2 scene
      // selection and both scenes share the exact same AOI.
      if (beforeScene && afterScene) {
        await analyzeMultispectralChange();
      }

      // ------------------------------------------------------
      // 3. AI CHANGE INTERPRETATION
      // ------------------------------------------------------

      setIsAiInterpreting(true);

      const aiFormData = new FormData();

      aiFormData.append(
        "before_image",
        beforeBlob,
        beforeName || "before.png"
      );

      aiFormData.append(
        "after_image",
        afterBlob,
        afterName || "after.png"
      );

      aiFormData.append(
        "overall_change",
        String(changeData.overall_change ?? "")
      );

      aiFormData.append(
        "categories",
        JSON.stringify(changeData.categories || {})
      );

      aiFormData.append(
        "before_date",
        beforeDate || ""
      );

      aiFormData.append(
        "after_date",
        afterDate || ""
      );

      const aiResponse = await fetch(
        "https://satquery-ai-backend-r165.onrender.com/api/change-interpretation",
        {
          method: "POST",
          body: aiFormData,
        }
      );

      const aiData = await aiResponse.json();

      console.log(
        "AI CHANGE INTERPRETATION RESPONSE:",
        aiData
      );

      if (!aiResponse.ok || !aiData.success) {
        throw new Error(
          aiData.error ||
            "AI interpretation failed."
        );
      }

      setAiInterpretation(
        aiData.interpretation || ""
      );
    } catch (error) {
      console.error(
        "Change detection error:",
        error
      );

      const message =
        error?.message ||
        "AI interpretation could not be generated.";

      setAiError(message);

      if (!changeDetectionSucceeded) {
        alert(message);
      }
    } finally {
      setIsComparing(false);
      setIsAiInterpreting(false);
    }
  };

  // =========================================================
  // RESET
  // =========================================================

  const resetAll = () => {
    if (beforeImage) {
      URL.revokeObjectURL(beforeImage);
    }

    if (afterImage) {
      URL.revokeObjectURL(afterImage);
    }

    setBeforeImage(null);
    setAfterImage(null);

    setBeforeName("");
    setAfterName("");

    setBeforeDate("");
    setAfterDate("");

    setResult(null);
    setAiInterpretation(null);
    setAiError("");
    setMultispectralChangeResult(null);
    setMultispectralAiInsight(null);
    setMultispectralChangeError("");
  };

  // =========================================================
  // CLEANUP
  // =========================================================

  useEffect(() => {
    return () => {
      if (beforeImage) {
        URL.revokeObjectURL(beforeImage);
      }

      if (afterImage) {
        URL.revokeObjectURL(afterImage);
      }
    };
  }, []);

  // =========================================================
  // UI
  // =========================================================

  return (
    <div className="min-h-screen bg-[#030712] text-white">
      {/* BACKGROUND */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-[5%] top-[-150px] h-[500px] w-[500px] rounded-full bg-purple-600/10 blur-[160px]" />
        <div className="absolute right-[-100px] top-[30%] h-[500px] w-[500px] rounded-full bg-blue-600/10 blur-[170px]" />
        <div className="absolute bottom-[-150px] left-[35%] h-[400px] w-[400px] rounded-full bg-cyan-500/5 blur-[150px]" />
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

        <div className="hidden items-center gap-8 text-sm text-gray-400 md:flex">
          <button
            onClick={() => navigate("/")}
            className="transition hover:text-white"
          >
            Dashboard
          </button>

          <button
            onClick={() => navigate("/analysis")}
            className="transition hover:text-white"
          >
            Analysis
          </button>

          <button className="text-purple-400">
            Change Detection
          </button>
        </div>
      </nav>

      {/* MAIN */}
      <main className="relative z-10 mx-auto max-w-7xl px-6 py-12">
        {/* HEADER */}
        <div className="mb-10">
          <div className="mb-4 flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-purple-400" />

            <p className="text-xs uppercase tracking-[0.3em] text-purple-400">
              Temporal Change Intelligence
            </p>
          </div>

          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <h2 className="text-4xl font-bold tracking-tight md:text-6xl">
                Detect What
                <span className="block text-purple-400">
                  Changed on Earth
                </span>
              </h2>

              <p className="mt-5 max-w-2xl text-base leading-7 text-gray-400 md:text-lg">
                Upload satellite images from two different
                observations and identify visual changes
                between them.
              </p>
            </div>

            <button
              onClick={() => navigate("/analysis")}
              className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm text-gray-300 transition hover:bg-white/10 hover:text-white"
            >
              ← All Analysis
            </button>
          </div>
        </div>

        {/* BEFORE / AFTER */}
        <div className="grid gap-6 lg:grid-cols-2">
          <ImageUploadCard
            title="Before"
            subtitle="Original observation"
            date={beforeDate}
            setDate={setBeforeDate}
            image={beforeImage}
            fileName={beforeName}
            type="before"
            onUpload={handleUpload}
            onRemove={removeImage}
            accent="blue"
          />

          <ImageUploadCard
            title="After"
            subtitle="Recent observation"
            date={afterDate}
            setDate={setAfterDate}
            image={afterImage}
            fileName={afterName}
            type="after"
            onUpload={handleUpload}
            onRemove={removeImage}
            accent="purple"
          />
        </div>

        {/* DEMO PAIR BUTTON */}
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={loadDemoPair}
            className="rounded-xl border border-purple-400/20 bg-purple-500/10 px-6 py-3 text-sm font-semibold text-purple-300 transition hover:bg-purple-500/20"
          >
            ✦ Use Demo Pair — 2025 → 2026
          </button>
        </div>

        {/* COMPARE BUTTON */}
        <div className="mt-8 flex flex-col items-center">
          <button
            onClick={compareImages}
            disabled={
              !beforeImage ||
              !afterImage ||
              isComparing
            }
            className={`group rounded-2xl px-10 py-4 text-base font-semibold shadow-2xl transition-all duration-300 ${
              beforeImage && afterImage
                ? "bg-purple-500 shadow-purple-500/30 hover:scale-105 hover:bg-purple-400"
                : "cursor-not-allowed bg-gray-700 text-gray-500"
            }`}
          >
            {isComparing ? (
              <>
                <span className="mr-2 inline-block animate-spin">
                  ◌
                </span>
                Comparing Images...
              </>
            ) : (
              <>
                🔍 Compare Satellite Images
                <span className="ml-2 inline-block transition group-hover:translate-x-1">
                  →
                </span>
              </>
            )}
          </button>

          <div className="mt-4 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-gray-500">
            {beforeImage && afterImage
              ? "● Two images ready for comparison"
              : "Upload both images to begin"}
          </div>
        </div>

        {/* RESULT */}
        {result && (
          <section className="mt-12 overflow-hidden rounded-3xl border border-purple-500/20 bg-white/[0.03] shadow-2xl backdrop-blur-xl">
            {/* RESULT HEADER */}
            <div className="flex flex-col justify-between gap-4 border-b border-white/10 px-6 py-6 md:flex-row md:items-center">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-purple-400">
                  Comparison Workspace
                </p>

                <h3 className="mt-2 text-2xl font-semibold">
                  Satellite Scene Comparison
                </h3>
              </div>

              <div className="rounded-full border border-green-400/20 bg-green-400/10 px-4 py-2 text-xs text-green-400">
                ● ANALYSIS COMPLETE
              </div>
            </div>

            {/* COMPARISON IMAGES */}
            <div className="grid gap-6 p-6 lg:grid-cols-2">
              {/* BEFORE */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-medium">
                    Before
                  </p>

                  <span className="text-xs text-blue-400">
                    ORIGINAL
                  </span>
                </div>

                <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
                  <img
                    src={beforeImage}
                    alt="Before satellite scene"
                    className="max-h-[450px] w-full object-contain"
                  />
                </div>
              </div>

              {/* AFTER */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-medium">
                    After
                  </p>

                  <span className="text-xs text-purple-400">
                    RECENT
                  </span>
                </div>

                <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
                  <img
                    src={afterImage}
                    alt="After satellite scene"
                    className="max-h-[450px] w-full object-contain"
                  />
                </div>
              </div>
            </div>

            {/* CHANGE MAP */}
            <div className="border-t border-white/10 p-6">
              <div className="mb-5 flex flex-col justify-between gap-4 md:flex-row md:items-center">
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-purple-400">
                    Change Map
                  </p>

                  <h3 className="mt-1 text-xl font-semibold">
                    Classified Changes
                  </h3>
                </div>

                <div className="rounded-xl border border-purple-400/20 bg-purple-500/10 px-5 py-3">
                  <p className="text-xs text-gray-500">
                    OVERALL CHANGE
                  </p>

                  <p className="mt-1 text-xl font-bold text-purple-400">
                    {result.percentage}%
                  </p>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-purple-400/20 bg-black">
                <img
                  src={result.image}
                  alt="Multi-category satellite change map"
                  className="max-h-[600px] w-full object-contain"
                />
              </div>

              {/* CATEGORY STATS */}
              <div className="mt-6">
                <p className="mb-4 text-xs uppercase tracking-[0.25em] text-gray-500">
                  Change Categories
                </p>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <CategoryStat
                    icon="💧"
                    label="Water Bodies"
                    value={result.categories?.water ?? 0}
                    color="blue"
                  />

                  <CategoryStat
                    icon="🌱"
                    label="Vegetation"
                    value={result.categories?.vegetation ?? 0}
                    color="green"
                  />

                  <CategoryStat
                    icon="🏗️"
                    label="Built-up"
                    value={result.categories?.built_up ?? 0}
                    color="red"
                  />

                  <CategoryStat
                    icon="🟨"
                    label="Bare Land"
                    value={result.categories?.bare_land ?? 0}
                    color="yellow"
                  />

                  <CategoryStat
                    icon="🌾"
                    label="Agriculture"
                    value={result.categories?.agriculture ?? 0}
                    color="cyan"
                  />

                  <CategoryStat
                    icon="◈"
                    label="Other"
                    value={result.categories?.other ?? 0}
                    color="purple"
                  />
                </div>
              </div>

              {/* LEGEND */}
              <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 text-xs text-gray-400">
                <div className="font-medium text-gray-300">
                  Map Legend:
                </div>

                <LegendItem
                  color="bg-blue-500"
                  label="Water"
                />

                <LegendItem
                  color="bg-green-500"
                  label="Vegetation"
                />

                <LegendItem
                  color="bg-red-500"
                  label="Built-up"
                />

                <LegendItem
                  color="bg-yellow-400"
                  label="Bare Land"
                />

                <LegendItem
                  color="bg-cyan-400"
                  label="Agriculture"
                />

                <LegendItem
                  color="bg-purple-500"
                  label="Other"
                />

                <LegendItem
                  color="bg-gray-500"
                  label="Unchanged"
                />
              </div>
            </div>

            {/* AI INTERPRETATION */}
            <div className="border-t border-white/10 bg-purple-500/[0.04] p-6">
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-purple-400/20 bg-purple-500/10 text-xl">
                  ✦
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                    <h3 className="font-semibold">
                      AI Change Interpretation
                    </h3>

                    <span
                      className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-wider ${
                        isAiInterpreting
                          ? "border-yellow-400/20 bg-yellow-400/10 text-yellow-400"
                          : aiInterpretation
                          ? "border-green-400/20 bg-green-400/10 text-green-400"
                          : "border-white/10 bg-white/5 text-gray-500"
                      }`}
                    >
                      {isAiInterpreting
                        ? "AI ANALYZING"
                        : aiInterpretation
                        ? "LIVE MODEL"
                        : "READY"}
                    </span>
                  </div>

                  {isAiInterpreting ? (
                    <div className="mt-4 rounded-2xl border border-yellow-400/10 bg-yellow-400/[0.04] p-4">
                      <div className="flex items-center gap-3">
                        <span className="inline-block animate-spin text-lg">
                          ◌
                        </span>

                        <p className="text-sm text-gray-300">
                          AI is comparing the before and after satellite
                          scenes...
                        </p>
                      </div>
                    </div>
                  ) : aiInterpretation ? (
                    <div className="mt-4 rounded-2xl border border-green-400/20 bg-green-400/[0.05] p-5">
                      <p className="whitespace-pre-line text-sm leading-7 text-gray-200">
                        {aiInterpretation}
                      </p>
                    </div>
                  ) : aiError ? (
                    <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/[0.05] p-4">
                      <p className="text-sm text-red-300">
                        {aiError}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-3 max-w-3xl text-sm leading-6 text-gray-500">
                      The AI interpretation will automatically analyze the
                      detected changes after the comparison is complete.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* =====================================================
            PHASE 7 — MULTISPECTRAL CHANGE INTELLIGENCE
        ====================================================== */}
        {(multispectralChangeResult || isMultispectralChangeAnalyzing || multispectralChangeError) && (
          <section className="mt-8 overflow-hidden rounded-3xl border border-cyan-400/20 bg-white/[0.03] shadow-2xl backdrop-blur-xl">
            <div className="border-b border-white/10 bg-cyan-500/[0.04] px-6 py-6">
              <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-cyan-400">
                    Phase 7 · Multispectral Intelligence
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold">
                    NDVI + NDWI + NDBI Change
                  </h3>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
                    Compares vegetation, water and built-up indicators for the same Sentinel-2 AOI across the two observations.
                  </p>
                </div>

                <span className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-wider ${
                  isMultispectralChangeAnalyzing
                    ? "border-yellow-400/20 bg-yellow-400/10 text-yellow-400"
                    : multispectralAiInsight
                    ? "border-green-400/20 bg-green-400/10 text-green-400"
                    : "border-white/10 bg-white/5 text-gray-500"
                }`}>
                  {isMultispectralChangeAnalyzing ? "ANALYZING" : multispectralAiInsight ? "LIVE MODEL" : "READY"}
                </span>
              </div>
            </div>

            {isMultispectralChangeAnalyzing ? (
              <div className="p-6">
                <div className="rounded-2xl border border-yellow-400/10 bg-yellow-400/[0.04] p-5">
                  <div className="flex items-center gap-3">
                    <span className="inline-block animate-spin text-lg">◌</span>
                    <div>
                      <p className="text-sm font-medium text-gray-200">
                        Running multispectral comparison...
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        Calculating NDVI, NDWI and NDBI for both observations.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : multispectralChangeError ? (
              <div className="p-6">
                <div className="rounded-2xl border border-red-400/20 bg-red-500/[0.05] p-5">
                  <p className="text-sm text-red-300">{multispectralChangeError}</p>
                  {!beforeScene || !afterScene ? (
                    <p className="mt-2 text-xs text-gray-500">
                      Phase 7 requires Sentinel-2 scenes selected with an AOI. Manual image uploads continue to use the existing visual change detection.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : multispectralChangeResult ? (
              <div className="p-6">
                <div className="grid gap-4 md:grid-cols-3">
                  <MultispectralMetricCard
                    title="NDVI · Vegetation"
                    before={multispectralChangeResult.comparison?.ndvi?.before}
                    after={multispectralChangeResult.comparison?.ndvi?.after}
                    change={multispectralChangeResult.comparison?.ndvi?.change}
                    direction={multispectralChangeResult.comparison?.ndvi?.direction}
                    accent="green"
                  />
                  <MultispectralMetricCard
                    title="NDWI · Water"
                    before={multispectralChangeResult.comparison?.ndwi?.before}
                    after={multispectralChangeResult.comparison?.ndwi?.after}
                    change={multispectralChangeResult.comparison?.ndwi?.change}
                    direction={multispectralChangeResult.comparison?.ndwi?.direction}
                    accent="blue"
                  />
                  <MultispectralMetricCard
                    title="NDBI · Built-up"
                    before={multispectralChangeResult.comparison?.ndbi?.before}
                    after={multispectralChangeResult.comparison?.ndbi?.after}
                    change={multispectralChangeResult.comparison?.ndbi?.change}
                    direction={multispectralChangeResult.comparison?.ndbi?.direction}
                    accent="purple"
                  />
                </div>

                <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-5">
                  <p className="text-xs uppercase tracking-[0.25em] text-cyan-400">
                    Detected Multispectral Changes
                  </p>
                  <p className="mt-3 text-sm leading-7 text-gray-300">
                    {multispectralChangeResult.interpretation?.summary || "No summary available."}
                  </p>
                </div>

                {multispectralAiInsight?.insight && (
                  <div className="mt-5 rounded-2xl border border-cyan-400/20 bg-cyan-500/[0.04] p-5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-cyan-300">
                        ✦ AI Multispectral Insight
                      </p>
                      <span className="rounded-full border border-green-400/20 bg-green-400/10 px-3 py-1 text-[10px] uppercase tracking-wider text-green-400">
                        {multispectralAiInsight.mode === "demo" ? "DEMO FALLBACK" : "LIVE MODEL"}
                      </span>
                    </div>
                    <p className="mt-4 whitespace-pre-line text-sm leading-7 text-gray-200">
                      {multispectralAiInsight.insight}
                    </p>
                  </div>
                )}

                <p className="mt-4 text-xs leading-5 text-gray-600">
                  Note: NDVI, NDWI and NDBI percentage indicators are independent and may overlap; they are not a mutually exclusive 100% land-cover partition.
                </p>
              </div>
            ) : null}
          </section>
        )}

        {/* RESET */}
        {(beforeImage || afterImage || result) && (
          <div className="mt-6 flex justify-center">
            <button
              onClick={resetAll}
              className="rounded-xl border border-red-400/20 bg-red-500/5 px-5 py-2.5 text-sm text-red-400 transition hover:bg-red-500/10"
            >
              Reset Comparison
            </button>
          </div>
        )}
      </main>

      {/* HIDDEN CANVAS */}
      <canvas
        ref={canvasRef}
        className="hidden"
      />
    </div>
  );
}

// =========================================================
// MULTISPECTRAL METRIC CARD
// =========================================================

function MultispectralMetricCard({ title, before, after, change, direction, accent }) {
  const accents = {
    green: "border-green-400/20 bg-green-500/[0.04] text-green-400",
    blue: "border-blue-400/20 bg-blue-500/[0.04] text-blue-400",
    purple: "border-purple-400/20 bg-purple-500/[0.04] text-purple-400",
  };

  const cls = accents[accent] || accents.purple;
  const directionLabel = direction === "increase" ? "↑ Increase" : direction === "decrease" ? "↓ Decrease" : "→ Stable";

  return (
    <div className={`rounded-2xl border p-5 ${cls}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">{title}</p>
        <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[10px] uppercase tracking-wider">
          {directionLabel}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
          <p className="text-[10px] uppercase tracking-wider text-gray-500">Before</p>
          <p className="mt-1 text-lg font-semibold text-gray-200">{Number(before ?? 0).toFixed(4)}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
          <p className="text-[10px] uppercase tracking-wider text-gray-500">After</p>
          <p className="mt-1 text-lg font-semibold text-gray-200">{Number(after ?? 0).toFixed(4)}</p>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
        <p className="text-[10px] uppercase tracking-wider text-gray-500">Change</p>
        <p className="mt-1 text-sm font-semibold">{Number(change ?? 0).toFixed(4)}</p>
      </div>
    </div>
  );
}

// =========================================================
// CATEGORY STAT
// =========================================================

function CategoryStat({
  icon,
  label,
  value,
  color,
}) {
  const colorClasses = {
    blue: {
      border: "border-blue-400/20",
      bg: "bg-blue-500/5",
      dot: "bg-blue-500",
      text: "text-blue-400",
    },

    green: {
      border: "border-green-400/20",
      bg: "bg-green-500/5",
      dot: "bg-green-500",
      text: "text-green-400",
    },

    red: {
      border: "border-red-400/20",
      bg: "bg-red-500/5",
      dot: "bg-red-500",
      text: "text-red-400",
    },

    yellow: {
      border: "border-yellow-400/20",
      bg: "bg-yellow-500/5",
      dot: "bg-yellow-400",
      text: "text-yellow-400",
    },

    cyan: {
      border: "border-cyan-400/20",
      bg: "bg-cyan-500/5",
      dot: "bg-cyan-400",
      text: "text-cyan-400",
    },

    purple: {
      border: "border-purple-400/20",
      bg: "bg-purple-500/5",
      dot: "bg-purple-500",
      text: "text-purple-400",
    },
  };

  const colors =
    colorClasses[color] || colorClasses.purple;

  return (
    <div
      className={`flex items-center justify-between rounded-xl border ${colors.border} ${colors.bg} px-4 py-3`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`h-4 w-4 shrink-0 rounded ${colors.dot}`}
        />

        <span className="text-sm text-gray-300">
          {icon} {label}
        </span>
      </div>

      <span
        className={`text-sm font-semibold ${colors.text}`}
      >
        {Number(value || 0).toFixed(2)}%
      </span>
    </div>
  );
}

// =========================================================
// LEGEND ITEM
// =========================================================

function LegendItem({ color, label }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`h-3 w-3 rounded ${color}`}
      />

      <span>{label}</span>
    </div>
  );
}

// =========================================================
// IMAGE UPLOAD CARD
// =========================================================

function ImageUploadCard({
  title,
  subtitle,
  date,
  setDate,
  image,
  fileName,
  type,
  onUpload,
  onRemove,
  accent,
}) {
  const accentClasses = {
    blue: {
      border: "border-blue-400/20",
      hover: "hover:border-blue-400/50",
      bg: "bg-blue-500/[0.04]",
      text: "text-blue-400",
      glow: "bg-blue-500/10",
    },

    purple: {
      border: "border-purple-400/20",
      hover: "hover:border-purple-400/50",
      bg: "bg-purple-500/[0.04]",
      text: "text-purple-400",
      glow: "bg-purple-500/10",
    },
  };

  const colors = accentClasses[accent];

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl">
      {/* HEADER */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h3 className="text-xl font-semibold">
              {title}
            </h3>

            <span
              className={`
                rounded-full
                border
                px-3
                py-1
                text-[10px]
                uppercase
                tracking-wider
                ${colors.border}
                ${colors.bg}
                ${colors.text}
              `}
            >
              {title === "Before"
                ? "ORIGINAL"
                : "RECENT"}
            </span>
          </div>

          <p className="mt-1 text-xs text-gray-500">
            {subtitle}
          </p>
        </div>

        <div className="text-2xl">
          {title === "Before" ? "🕐" : "⚡"}
        </div>
      </div>

      {/* IMAGE */}
      {!image ? (
        <label
          className={`
            relative
            flex
            min-h-[330px]
            cursor-pointer
            flex-col
            items-center
            justify-center
            overflow-hidden
            rounded-2xl
            border
            border-dashed
            ${colors.border}
            ${colors.bg}
            px-6
            text-center
            transition
            duration-300
            ${colors.hover}
          `}
        >
          <div
            className={`
              absolute
              h-48
              w-48
              rounded-full
              ${colors.glow}
              blur-3xl
            `}
          />

          <div className="relative text-5xl">
            🛰️
          </div>

          <h4 className="relative mt-5 text-lg font-semibold">
            Upload {title} Image
          </h4>

          <p className="relative mt-2 text-sm text-gray-500">
            Click to browse satellite imagery
          </p>

          <div className="relative mt-5 flex gap-2">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] text-gray-500">
              JPG
            </span>

            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] text-gray-500">
              PNG
            </span>

            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] text-gray-500">
              TIFF
            </span>
          </div>

          <input
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/tiff"
            className="hidden"
            onChange={(event) =>
              onUpload(event, type)
            }
          />
        </label>
      ) : (
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black">
          <img
            src={image}
            alt={`${title} satellite`}
            className="h-[330px] w-full object-contain"
          />

          <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between rounded-xl border border-white/10 bg-black/75 px-4 py-3 backdrop-blur-xl">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-gray-500">
                Uploaded Image
              </p>

              <p className="truncate text-sm text-gray-200">
                {fileName}
              </p>
            </div>

            <button
              onClick={() => onRemove(type)}
              className="ml-3 shrink-0 rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-400 transition hover:bg-red-500/20"
            >
              Remove
            </button>
          </div>
        </div>
      )}

      {/* DATE */}
      <div className="mt-5">
        <label className="mb-2 block text-xs uppercase tracking-wider text-gray-500">
          Observation Date
        </label>

        <input
          type="date"
          value={date}
          onChange={(e) =>
            setDate(e.target.value)
          }
          className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-blue-500/50"
        />
      </div>
    </div>
  );
}