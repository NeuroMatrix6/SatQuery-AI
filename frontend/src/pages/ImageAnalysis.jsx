import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { askVQA } from "../services/ai";

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
  const [question, setQuestion] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const processImage = (file) => {
    if (!file) return;

    setError("");
    setAnswer(null);

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

    if (previewUrl) URL.revokeObjectURL(previewUrl);

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setSelectedFile(file);
    setFileName(file.name);
    setFileSize(formatSize(file.size));
    setQuestion("");

    // PNG/JPG/JPEG can be rendered directly by the browser.
    if (isBrowserPreviewable(file)) {
      const img = new Image();
      img.onload = () => setDimensions(`${img.width} × ${img.height}px`);
      img.onerror = () => setDimensions("Image dimensions unavailable");
      img.src = url;
    } else {
      setDimensions(`${ext.replace(".", "").toUpperCase()} satellite image`);
    }
  };

  const handleFile = (event) => {
    const file = event.target.files?.[0];
    if (file) processImage(file);
    event.target.value = "";
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) processImage(file);
  };

  const removeImage = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setSelectedFile(null);
    setFileName("");
    setFileSize("");
    setDimensions("");
    setQuestion("");
    setAnswer(null);
    setError("");
  };

  const analyzeWithAI = async () => {
    if (!selectedFile || !question.trim()) return;

    setIsAnalyzing(true);
    setAnswer(null);
    setError("");

    try {
      const result = await askVQA({
        file: selectedFile,
        question: question.trim(),
      });
      setAnswer(result);
    } catch (err) {
      setError(err?.message || "Unable to connect to the AI backend.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
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

  return (
    <div className="min-h-screen bg-[#030712] text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-[5%] top-[-150px] h-[500px] w-[500px] rounded-full bg-blue-600/10 blur-[160px]" />
        <div className="absolute right-[-100px] top-[35%] h-[500px] w-[500px] rounded-full bg-purple-600/10 blur-[170px]" />
      </div>

      <nav className="relative z-20 flex items-center justify-between border-b border-white/10 bg-black/30 px-8 py-5 backdrop-blur-xl">
        <button onClick={() => navigate("/")} className="flex items-center gap-3 text-left">
          <div className="text-3xl">🛰️</div>
          <div>
            <h1 className="text-xl font-semibold">SatQuery AI</h1>
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

      <main className="relative z-10 mx-auto max-w-7xl px-6 py-12">
        <div className="mb-10">
          <div className="mb-4 flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />
            <p className="text-xs uppercase tracking-[0.3em] text-blue-400">
              Image Intelligence
            </p>
          </div>
          <h2 className="text-4xl font-bold md:text-5xl">
            Understand Your <span className="text-blue-400">Satellite Image</span>
          </h2>
          <p className="mt-4 max-w-2xl text-gray-400">
            Upload satellite imagery and ask AI questions about buildings, roads,
            vegetation, water bodies, land use and other visible features.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="relative min-h-[560px] overflow-hidden rounded-3xl border border-white/10 bg-[#050b16]">
            <div
              className="absolute inset-0 opacity-20"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(50,150,255,.15) 1px, transparent 1px), linear-gradient(90deg, rgba(50,150,255,.15) 1px, transparent 1px)",
                backgroundSize: "45px 45px",
              }}
            />

            <div className="absolute left-6 right-6 top-6 z-10 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.25em] text-gray-500">
                  Satellite Workspace
                </p>
                <p className="mt-1 max-w-[420px] truncate text-sm text-gray-300">
                  {fileName || "No satellite image loaded"}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${
                  previewUrl
                    ? "border-green-400/20 bg-green-400/10 text-green-400"
                    : "border-yellow-400/20 bg-yellow-400/10 text-yellow-400"
                }`}
              >
                ● {previewUrl ? "IMAGE LOADED" : "WAITING"}
              </span>
            </div>

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
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    className={`flex min-h-[340px] cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed px-8 text-center transition duration-300 ${
                      isDragging
                        ? "scale-[1.01] border-blue-400 bg-blue-500/10"
                        : "border-blue-400/30 bg-blue-500/[0.03] hover:border-blue-400/60 hover:bg-blue-500/[0.08]"
                    }`}
                  >
                    <div className="mb-6 text-7xl">🛰️</div>
                    <h3 className="text-2xl font-semibold">
                      {isDragging ? "Drop Satellite Image Here" : "Upload Satellite Image"}
                    </h3>
                    <p className="mt-3 max-w-md text-sm leading-6 text-gray-500">
                      Drag and drop a satellite raster here, or click to browse.
                    </p>
                    <div className="mt-6 flex flex-wrap justify-center gap-2">
                      {["PNG", "JPG", "GeoTIFF", "JP2", "J2K", "NITF"].map((format) => (
                        <span
                          key={format}
                          className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-gray-500"
                        >
                          {format}
                        </span>
                      ))}
                    </div>
                    <p className="mt-4 text-xs text-blue-400/70">
                      PNG/JPG images are previewed directly in the browser.
                    </p>
                    <p className="mt-2 text-xs text-gray-600">Maximum file size: 50 MB</p>
                  </label>
                  {error && (
                    <div className="mt-4 rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                      ⚠️ {error}
                    </div>
                  )}
                </div>
              ) : (
                <div className="relative flex h-full w-full items-center justify-center pb-24 pt-12">
                  {isBrowserPreviewable(selectedFile) ? (
                    <img
                      src={previewUrl}
                      alt={fileName || "Uploaded satellite image"}
                      className="max-h-[470px] max-w-full rounded-2xl border border-blue-400/20 object-contain shadow-2xl shadow-blue-900/20"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center rounded-3xl border border-blue-400/20 bg-blue-500/[0.05] px-10 py-16 text-center">
                      <div className="text-6xl">🛰️</div>
                      <p className="mt-5 text-lg font-semibold">Satellite Image Loaded</p>
                      <p className="mt-2 max-w-[350px] truncate text-sm text-gray-500">{fileName}</p>
                      <p className="mt-2 text-xs text-blue-400">{dimensions}</p>
                      <p className="mt-4 max-w-md text-xs leading-5 text-gray-600">
                        This raster format is accepted by the AI pipeline but is not
                        natively previewed by most browsers.
                      </p>
                    </div>
                  )}

                  <div className="absolute bottom-2 left-0 right-0 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/80 px-5 py-4 backdrop-blur-xl">
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500">Uploaded satellite image</p>
                      <p className="max-w-[500px] truncate text-sm text-gray-200">{fileName}</p>
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

            <input
              id="image-upload"
              type="file"
              accept=".png,.jpg,.jpeg,.tif,.tiff,.jp2,.j2k,.nitf,image/png,image/jpeg,image/tiff"
              className="hidden"
              onChange={handleFile}
            />
          </div>

          <div className="rounded-3xl border border-blue-500/20 bg-gradient-to-b from-blue-500/[0.08] to-transparent p-6 backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/15 text-xl">✦</div>
              <div>
                <h3 className="font-semibold">Ask AI</h3>
                <p className="text-xs text-gray-500">Satellite image intelligence</p>
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-white/10 bg-black/30 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">AI STATUS</span>
                <span className="flex items-center gap-2 text-xs text-green-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-400" /> READY
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-gray-400">
                {previewUrl
                  ? "Your satellite image is ready. Ask a question to begin analysis."
                  : "Upload a satellite image first to enable AI analysis."}
              </p>
            </div>

            <div className="mt-6">
              <label className="mb-2 block text-xs uppercase tracking-wider text-gray-500">
                Your Question
              </label>
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
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

            <button
              disabled={!previewUrl || !question.trim() || isAnalyzing}
              onClick={analyzeWithAI}
              className={`mt-4 w-full rounded-xl py-3.5 font-semibold transition ${
                previewUrl && question.trim() && !isAnalyzing
                  ? "bg-blue-500 shadow-lg shadow-blue-500/20 hover:bg-blue-400"
                  : "cursor-not-allowed bg-gray-700 text-gray-500"
              }`}
            >
              {isAnalyzing ? "Analyzing satellite image..." : "Analyze with AI ✦"}
            </button>

            {answer && (
              <div className="mt-5 rounded-2xl border border-green-400/20 bg-green-400/[0.06] p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-green-400">VQA Result</p>
                  <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-gray-400">
                    {answer.provider === "huggingface" ? "LIVE MODEL" : "DEMO FALLBACK"}
                  </span>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-200">
                  {answer.answer}
                </p>
              </div>
            )}

            {error && previewUrl && (
              <div className="mt-4 rounded-xl border border-red-400/20 bg-red-400/[0.06] p-3 text-xs leading-5 text-red-300">
                {error}
              </div>
            )}

            <div className="mt-7">
              <p className="text-xs uppercase tracking-wider text-gray-600">Try asking</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {suggestions.map((item) => (
                  <button
                    key={item}
                    disabled={!previewUrl}
                    onClick={() => setQuestion(item)}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-400 transition hover:border-blue-400/30 hover:text-blue-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <InfoCard icon="🛰️" title="Satellite Image" value={fileName || "Not uploaded"} />
          <InfoCard icon="💾" title="File Size" value={fileSize || "—"} />
          <InfoCard icon="🔍" title="Format / Size" value={dimensions || "—"} />
        </div>

        <div className="mt-6 rounded-2xl border border-blue-400/10 bg-blue-400/[0.03] p-5">
          <div className="flex gap-3">
            <span className="text-xl">🛰️</span>
            <div>
              <h3 className="text-sm font-semibold">Satellite image formats</h3>
              <p className="mt-1 text-xs leading-5 text-gray-500">
                PNG/JPG/JPEG can be previewed directly. GeoTIFF, JP2/J2K and NITF are
                accepted for the processing pipeline; the backend converts them to a
                compact JPEG before sending them to the vision model.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-8 flex items-center justify-between text-xs text-gray-600">
          <p>SatQuery AI • Image Intelligence</p>
          <button onClick={() => navigate("/analysis")} className="transition hover:text-gray-300">
            ← Back to Analysis
          </button>
        </div>
      </main>
    </div>
  );
}

function InfoCard({ icon, title, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <span className="text-xl">{icon}</span>
        <p className="text-xs uppercase tracking-wider text-gray-500">{title}</p>
      </div>
      <p className="mt-3 truncate text-lg font-medium">{value}</p>
    </div>
  );
}
