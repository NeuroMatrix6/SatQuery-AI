import { useEffect, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Rectangle,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/* =========================================================
   API
========================================================= */

const API_BASE =
  import.meta.env.VITE_BACKEND_URL ||
  "http://127.0.0.1:8000";

/* =========================================================
   LEAFLET MARKER FIX
========================================================= */

delete L.Icon.Default.prototype._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

/* =========================================================
   DEFAULT LOCATION
========================================================= */

const DEFAULT_LOCATION = [20.5937, 78.9629];

/* =========================================================
   MAP CONTROLLER
========================================================= */

function MapController({
  position,
  zoom,
  areaBounds,
}) {
  const map = useMap();

  /* -------------------------------------------------------
     Focus selected location
  ------------------------------------------------------- */

  useEffect(() => {
    if (!position || areaBounds) {
      return;
    }

    map.flyTo(position, zoom, {
      animate: true,
      duration: 1.2,
    });
  }, [
    position,
    zoom,
    areaBounds,
    map,
  ]);

  /* -------------------------------------------------------
     Fit AOI
  ------------------------------------------------------- */

  useEffect(() => {
    if (!areaBounds) {
      return;
    }

    map.fitBounds(areaBounds, {
      padding: [45, 45],
      maxZoom: 15,
      animate: true,
      duration: 0.8,
    });
  }, [
    areaBounds,
    map,
  ]);

  return null;
}

/* =========================================================
   MAP INTERACTION
========================================================= */

function MapInteraction({
  setPosition,
  setLocationName,
  selectingArea,
  areaStart,
  setAreaStart,
  setAreaBounds,
  setError,
  setSatelliteMessage,
}) {
  useMapEvents({
    click(event) {
      const lat = event.latlng.lat;
      const lng = event.latlng.lng;

      /* ---------------------------------------------------
         AOI SELECTION
      --------------------------------------------------- */

      if (selectingArea) {
        if (!areaStart) {
          setAreaStart([
            lat,
            lng,
          ]);

          setError("");
          return;
        }

        const startLat =
          areaStart[0];

        const startLng =
          areaStart[1];

        /* Same point */
        if (
          startLat === lat &&
          startLng === lng
        ) {
          setError(
            "Please select a different second corner."
          );

          return;
        }

        const bounds = [
          [
            Math.min(
              startLat,
              lat
            ),
            Math.min(
              startLng,
              lng
            ),
          ],
          [
            Math.max(
              startLat,
              lat
            ),
            Math.max(
              startLng,
              lng
            ),
          ],
        ];

        setAreaBounds(
          bounds
        );

        setAreaStart(
          null
        );

        setError("");

        setSatelliteMessage("");

        return;
      }

      /* ---------------------------------------------------
         NORMAL LOCATION SELECTION
      --------------------------------------------------- */

      setPosition([
        lat,
        lng,
      ]);

      setLocationName(
        "Selected Map Location"
      );

      setError("");

      setSatelliteMessage("");
    },
  });

  return null;
}

/* =========================================================
   MAIN COMPONENT
========================================================= */

export default function GeoLocation() {
  /* =======================================================
     LOCATION
  ======================================================= */

  const [
    position,
    setPosition,
  ] = useState(
    DEFAULT_LOCATION
  );

  const [
    locationName,
    setLocationName,
  ] = useState("India");

  /* =======================================================
     LOCATION SEARCH
  ======================================================= */

  const [
    search,
    setSearch,
  ] = useState("");

  const [
    searching,
    setSearching,
  ] = useState(false);

  const [
    results,
    setResults,
  ] = useState([]);

  const [
    error,
    setError,
  ] = useState("");

  /* =======================================================
     MAP
  ======================================================= */

  const [
    mapType,
    setMapType,
  ] = useState(
    "satellite"
  );

  const [
    selectedZoom,
    setSelectedZoom,
  ] = useState(5);

  /* =======================================================
     AOI
  ======================================================= */

  const [
    selectingArea,
    setSelectingArea,
  ] = useState(false);

  const [
    areaStart,
    setAreaStart,
  ] = useState(null);

  const [
    areaBounds,
    setAreaBounds,
  ] = useState(null);

  /* =======================================================
     DATE RANGE
  ======================================================= */

  const [
    fromDate,
    setFromDate,
  ] = useState("");

  const [
    toDate,
    setToDate,
  ] = useState("");

  const [
    dateError,
    setDateError,
  ] = useState("");

  /* =======================================================
     SATELLITE SEARCH
  ======================================================= */

  const [
    maxCloudCover,
    setMaxCloudCover,
  ] = useState(30);

  const [
    satelliteSearching,
    setSatelliteSearching,
  ] = useState(false);

  const [
    satelliteResults,
    setSatelliteResults,
  ] = useState([]);

  const [
    satelliteCount,
    setSatelliteCount,
  ] = useState(0);

  const [
    satelliteError,
    setSatelliteError,
  ] = useState("");

  const [
    satelliteMessage,
    setSatelliteMessage,
  ] = useState("");

  /* =======================================================
     SELECTED SCENE
  ======================================================= */

  const [
    selectedScene,
    setSelectedScene,
  ] = useState(null);

  /* =======================================================
     PREVIEW
  ======================================================= */

  const [
    previewLoading,
    setPreviewLoading,
  ] = useState(false);

  const [
    previewImage,
    setPreviewImage,
  ] = useState("");

  const [
    previewError,
    setPreviewError,
  ] = useState("");

  /* =======================================================
     SEARCH LOCATION
  ======================================================= */

  const searchLocation =
    async () => {
      const query =
        search
          .trim()
          .replace(/\s+/g, " ");

      if (!query) {
        setError(
          "Please enter a location."
        );
        return;
      }

      setSearching(true);

      setError("");

      setResults([]);

      setSatelliteMessage("");

      try {
        const response =
          await fetch(
            `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=1&dedupe=1&accept-language=en&q=${encodeURIComponent(
              query
            )}`,
            {
              headers: {
                Accept:
                  "application/json",
              },
            }
          );

        if (!response.ok) {
          throw new Error(
            "Location search failed. Please try again."
          );
        }

        const data =
          await response.json();

        if (
          !Array.isArray(
            data
          ) ||
          data.length === 0
        ) {
          throw new Error(
            "Location not found. Try a city, state, country or place."
          );
        }

        const priority = {
          country: 100,
          state: 90,
          city: 85,
          town: 80,
          municipality: 75,
          village: 65,
          county: 60,
          suburb: 45,
          neighbourhood: 35,
          administrative: 25,
          attraction: 10,
          amenity: 5,
        };

        const queryLower =
          query.toLowerCase();

        const rankedResults =
          [...data].sort(
            (a, b) => {
              const aType =
                priority[
                  a.type
                ] || 0;

              const bType =
                priority[
                  b.type
                ] || 0;

              const aName =
                (
                  a.name ||
                  ""
                ).toLowerCase();

              const bName =
                (
                  b.name ||
                  ""
                ).toLowerCase();

              const aExact =
                aName ===
                queryLower
                  ? 25
                  : 0;

              const bExact =
                bName ===
                queryLower
                  ? 25
                  : 0;

              return (
                bType +
                bExact -
                (aType +
                  aExact)
              );
            }
          );

        setResults(
          rankedResults
        );
      } catch (err) {
        setError(
          err?.message ||
            "Unable to find the requested location."
        );
      } finally {
        setSearching(
          false
        );
      }
    };

  /* =======================================================
     SELECT LOCATION
  ======================================================= */

  const selectLocation =
    (place) => {
      const lat =
        Number(place.lat);

      const lon =
        Number(place.lon);

      if (
        !Number.isFinite(
          lat
        ) ||
        !Number.isFinite(
          lon
        )
      ) {
        setError(
          "Invalid coordinates returned."
        );

        return;
      }

      setPosition([
        lat,
        lon,
      ]);

      setLocationName(
        place.display_name ||
          place.name ||
          "Selected Location"
      );

      /* Zoom */

      if (
        place.type ===
        "country"
      ) {
        setSelectedZoom(
          5
        );
      } else if (
        place.type ===
        "state"
      ) {
        setSelectedZoom(
          7
        );
      } else if (
        place.type ===
          "city" ||
        place.type ===
          "town" ||
        place.type ===
          "municipality"
      ) {
        setSelectedZoom(
          11
        );
      } else if (
        place.type ===
          "village" ||
        place.type ===
          "suburb"
      ) {
        setSelectedZoom(
          13
        );
      } else {
        setSelectedZoom(
          14
        );
      }

      /* Clear AOI */

      setAreaBounds(
        null
      );

      setAreaStart(
        null
      );

      setSelectingArea(
        false
      );

      /* Clear dates */

      setFromDate("");

      setToDate("");

      setDateError("");

      /* Clear scenes */

      setSatelliteResults(
        []
      );

      setSatelliteCount(
        0
      );

      setSatelliteError(
        ""
      );

      setSatelliteMessage(
        ""
      );

      setSelectedScene(
        null
      );

      /* Clear preview */

      setPreviewImage("");

      setPreviewError("");

      setResults([]);

      setError("");

      setSearch(
        place.name ||
          place.display_name ||
          search
      );
    };

  /* =======================================================
     AOI
  ======================================================= */

  const startAreaSelection =
    () => {
      setSelectingArea(
        true
      );

      setAreaStart(
        null
      );

      setAreaBounds(
        null
      );

      setSatelliteResults(
        []
      );

      setSatelliteCount(
        0
      );

      setSelectedScene(
        null
      );

      setPreviewImage("");

      setPreviewError("");

      setSatelliteMessage(
        ""
      );

      setSatelliteError(
        ""
      );

      setError("");
    };

  const cancelAreaSelection =
    () => {
      setSelectingArea(
        false
      );

      setAreaStart(
        null
      );

      setError("");
    };

  const clearArea = () => {
    setAreaBounds(
      null
    );

    setAreaStart(
      null
    );

    setSelectingArea(
      false
    );

    setSatelliteResults(
      []
    );

    setSatelliteCount(
      0
    );

    setSelectedScene(
      null
    );

    setPreviewImage("");

    setPreviewError("");

    setSatelliteMessage(
      ""
    );

    setSatelliteError(
      ""
    );

    setError("");
  };

  /* =======================================================
     AREA CALCULATION
  ======================================================= */

  const getApproxAreaKm2 =
    () => {
      if (!areaBounds) {
        return 0;
      }

      const south =
        areaBounds[0][0];

      const west =
        areaBounds[0][1];

      const north =
        areaBounds[1][0];

      const east =
        areaBounds[1][1];

      const earthRadiusKm =
        6371;

      const latDistance =
        ((north -
          south) *
          Math.PI /
          180) *
        earthRadiusKm;

      const meanLat =
        ((south +
          north) /
          2) *
        Math.PI /
        180;

      const lonDistance =
        ((east -
          west) *
          Math.PI /
          180) *
        earthRadiusKm *
        Math.cos(
          meanLat
        );

      return Math.abs(
        latDistance *
          lonDistance
      );
    };

  const areaKm2 =
    getApproxAreaKm2();

  /* =======================================================
     DATE VALIDATION
  ======================================================= */

  const isDateRangeValid =
    Boolean(
      fromDate &&
        toDate &&
        fromDate <=
          toDate
    );

  /* =======================================================
     READY
  ======================================================= */

  const isReadyForSatelliteData =
    Boolean(
      areaBounds &&
        areaKm2 > 0 &&
        fromDate &&
        toDate &&
        isDateRangeValid &&
        !dateError
    );

  /* =======================================================
     SENTINEL-2 SEARCH
  ======================================================= */

  const handleSatelliteSearch =
    async () => {
      if (
        !isReadyForSatelliteData
      ) {
        return;
      }

      setSatelliteSearching(
        true
      );

      setSatelliteError("");

      setSatelliteMessage(
        ""
      );

      setSatelliteResults(
        []
      );

      setSatelliteCount(
        0
      );

      setSelectedScene(
        null
      );

      setPreviewImage("");

      setPreviewError("");

      try {
        const west =
          areaBounds[0][1];

        const south =
          areaBounds[0][0];

        const east =
          areaBounds[1][1];

        const north =
          areaBounds[1][0];

        const formData =
          new FormData();

        formData.append(
          "west",
          String(west)
        );

        formData.append(
          "south",
          String(south)
        );

        formData.append(
          "east",
          String(east)
        );

        formData.append(
          "north",
          String(north)
        );

        formData.append(
          "from_date",
          fromDate
        );

        formData.append(
          "to_date",
          toDate
        );

        formData.append(
          "max_cloud_cover",
          String(
            maxCloudCover
          )
        );

        const response =
          await fetch(
            `${API_BASE}/api/satellite-search`,
            {
              method:
                "POST",
              body:
                formData,
            }
          );

        let data;

        try {
          data =
            await response.json();
        } catch {
          throw new Error(
            `Satellite API returned an invalid response (${response.status}).`
          );
        }

        if (
          !response.ok ||
          !data.success
        ) {
          throw new Error(
            data?.error ||
              "Unable to search Sentinel-2 data."
          );
        }

        const scenes =
          Array.isArray(
            data.scenes
          )
            ? data.scenes
            : [];

        setSatelliteResults(
          scenes
        );

        setSatelliteCount(
          scenes.length
        );

        if (
          scenes.length ===
          0
        ) {
          setSatelliteMessage(
            "No Sentinel-2 scenes matched the selected AOI, date range and cloud-cover limit."
          );
        } else {
          setSatelliteMessage(
            `${scenes.length} Sentinel-2 scene${
              scenes.length ===
              1
                ? ""
                : "s"
            } found successfully.`
          );
        }
      } catch (err) {
        console.error(
          "SATELLITE SEARCH ERROR:",
          err
        );

        setSatelliteError(
          err?.message ||
            "Unable to retrieve Sentinel-2 scenes."
        );
      } finally {
        setSatelliteSearching(
          false
        );
      }
    };

  /* =======================================================
     SELECT SCENE
  ======================================================= */

  const selectScene =
    (scene) => {
      setSelectedScene(
        scene
      );

      setPreviewImage("");

      setPreviewError("");

      setSatelliteMessage(
        `Selected scene: ${
          scene.product_name ||
          scene.id
        }`
      );
    };

  /* =======================================================
     PREVIEW SELECTED SENTINEL-2 SCENE
  ======================================================= */

  const previewSelectedScene =
    async () => {
      if (
        !selectedScene ||
        !areaBounds
      ) {
        setPreviewError(
          "Please select a scene and analysis area first."
        );

        return;
      }

      const acquisitionDate =
        selectedScene
          .acquisition_date;

      if (
        !acquisitionDate
      ) {
        setPreviewError(
          "Selected scene does not contain an acquisition date."
        );

        return;
      }

      setPreviewLoading(
        true
      );

      setPreviewError("");

      setPreviewImage("");

      setSatelliteMessage(
        ""
      );

      try {
        const west =
          areaBounds[0][1];

        const south =
          areaBounds[0][0];

        const east =
          areaBounds[1][1];

        const north =
          areaBounds[1][0];

        /*
         * Send the full acquisition timestamp.
         * Backend can use the day/time to request
         * the selected observation.
         */

        const formData =
          new FormData();

        formData.append(
          "west",
          String(west)
        );

        formData.append(
          "south",
          String(south)
        );

        formData.append(
          "east",
          String(east)
        );

        formData.append(
          "north",
          String(north)
        );

        formData.append(
          "acquisition_date",
          acquisitionDate
        );

        const response =
          await fetch(
            `${API_BASE}/api/satellite-preview`,
            {
              method:
                "POST",
              body:
                formData,
            }
          );

        let data;

        try {
          data =
            await response.json();
        } catch {
          throw new Error(
            `Preview API returned an invalid response (${response.status}).`
          );
        }

        if (
          !response.ok ||
          !data.success
        ) {
          throw new Error(
            data?.error ||
              "Unable to generate Sentinel-2 preview."
          );
        }

        if (!data.image) {
          throw new Error(
            "Sentinel-2 preview image was not returned."
          );
        }

        setPreviewImage(
          data.image
        );

        setSatelliteMessage(
          "Sentinel-2 preview generated successfully."
        );
      } catch (err) {
        console.error(
          "SATELLITE PREVIEW ERROR:",
          err
        );

        setPreviewError(
          err?.message ||
            "Unable to load Sentinel-2 preview."
        );
      } finally {
        setPreviewLoading(
          false
        );
      }
    };

  /* =======================================================
     FOCUS AOI
  ======================================================= */

  const focusArea =
    () => {
      if (!areaBounds) {
        return;
      }

      setAreaBounds([
        [
          ...areaBounds[0],
        ],
        [
          ...areaBounds[1],
        ],
      ]);
    };

  /* =======================================================
     RESET
  ======================================================= */

  const resetLocation =
    () => {
      setPosition(
        DEFAULT_LOCATION
      );

      setLocationName(
        "India"
      );

      setSearch("");

      setResults([]);

      setError("");

      setMapType(
        "satellite"
      );

      setSelectedZoom(5);

      setAreaBounds(
        null
      );

      setAreaStart(
        null
      );

      setSelectingArea(
        false
      );

      setFromDate("");

      setToDate("");

      setDateError("");

      setMaxCloudCover(
        30
      );

      setSatelliteSearching(
        false
      );

      setSatelliteResults(
        []
      );

      setSatelliteCount(
        0
      );

      setSatelliteError(
        ""
      );

      setSatelliteMessage(
        ""
      );

      setSelectedScene(
        null
      );

      setPreviewLoading(
        false
      );

      setPreviewImage("");

      setPreviewError("");
    };

  /* =======================================================
     FORMAT DATE
  ======================================================= */

  const formatDate =
    (value) => {
      if (!value) {
        return "Unknown";
      }

      const date =
        new Date(value);

      if (
        Number.isNaN(
          date.getTime()
        )
      ) {
        return value;
      }

      return date.toLocaleDateString(
        "en-IN",
        {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }
      );
    };

  /* =======================================================
     FORMAT TIME
  ======================================================= */

  const formatTime =
    (value) => {
      if (!value) {
        return "";
      }

      const date =
        new Date(value);

      if (
        Number.isNaN(
          date.getTime()
        )
      ) {
        return "";
      }

      return date.toLocaleTimeString(
        "en-IN",
        {
          hour: "2-digit",
          minute:
            "2-digit",
          second:
            "2-digit",
        }
      );
    };

  /* =======================================================
     FORMAT CLOUD
  ======================================================= */

  const formatCloud =
    (value) => {
      if (
        value === null ||
        value === undefined
      ) {
        return "N/A";
      }

      const num =
        Number(value);

      if (
        !Number.isFinite(
          num
        )
      ) {
        return "N/A";
      }

      return `${num.toFixed(
        1
      )}%`;
    };

  /* =======================================================
     UI
  ======================================================= */

  return (
    <div className="min-h-screen bg-[#030712] text-white">

      {/* =================================================
          BACKGROUND
      ================================================== */}

      <div className="pointer-events-none fixed inset-0 overflow-hidden">

        <div className="absolute left-[-100px] top-[-120px] h-[450px] w-[450px] rounded-full bg-blue-600/10 blur-[150px]" />

        <div className="absolute right-[-120px] top-[30%] h-[450px] w-[450px] rounded-full bg-purple-600/10 blur-[160px]" />

        <div className="absolute bottom-[-150px] left-[35%] h-[400px] w-[400px] rounded-full bg-cyan-500/5 blur-[150px]" />

      </div>

      {/* =================================================
          NAVBAR
      ================================================== */}

      <nav className="relative z-30 flex items-center justify-between border-b border-white/10 bg-black/30 px-5 py-5 backdrop-blur-xl md:px-8">

        <button
          onClick={() => {
            window.location.href =
              "/";
          }}
          className="flex items-center gap-3 text-left"
        >

          <div className="text-3xl">
            🛰️
          </div>

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
          onClick={() =>
            window.history.back()
          }
          className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-gray-300 transition hover:bg-white/10 hover:text-white"
        >
          ← Back
        </button>

      </nav>

      {/* =================================================
          MAIN
      ================================================== */}

      <main className="relative z-10 mx-auto max-w-7xl px-4 py-10 md:px-6 md:py-12">

        {/* =================================================
            HEADER
        ================================================== */}

        <div className="mb-8">

          <div className="mb-4 flex items-center gap-2">

            <span className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />

            <p className="text-xs uppercase tracking-[0.3em] text-blue-400">
              Geo Location Intelligence
            </p>

          </div>

          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">

            <div>

              <h2 className="text-4xl font-bold md:text-5xl">

                Select a{" "}

                <span className="text-blue-400">
                  Location
                </span>

              </h2>

              <p className="mt-4 max-w-2xl text-gray-400">
                Search for a location, define
                an analysis area, choose an
                observation period, and find
                real Sentinel-2 scenes.
              </p>

            </div>

            <button
              type="button"
              onClick={
                resetLocation
              }
              className="w-fit rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-gray-300 transition hover:bg-white/10 hover:text-white"
            >
              ↺ Reset
            </button>

          </div>

        </div>

        {/* =================================================
            SEARCH
        ================================================== */}

        <div className="relative z-[2000] mb-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl">

          <div className="flex flex-col gap-3 md:flex-row">

            <input
              type="text"
              value={search}
              onChange={(event) => {
                setSearch(
                  event.target
                    .value
                );

                if (error) {
                  setError("");
                }
              }}
              onKeyDown={(event) => {
                if (
                  event.key ===
                  "Enter"
                ) {
                  searchLocation();
                }
              }}
              placeholder="Search city, country, state or place..."
              className="flex-1 rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none placeholder:text-gray-600 focus:border-blue-500/50"
            />

            <button
              type="button"
              onClick={
                searchLocation
              }
              disabled={
                searching ||
                !search.trim()
              }
              className={`rounded-xl px-6 py-3 text-sm font-semibold transition ${
                searching ||
                !search.trim()
                  ? "cursor-not-allowed bg-gray-700 text-gray-500"
                  : "bg-blue-500 hover:bg-blue-400"
              }`}
            >

              {searching
                ? "Searching..."
                : "🔎 Search"}

            </button>

          </div>

          {/* SEARCH RESULTS */}

          {results.length >
            0 && (

            <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-[#050b16] shadow-2xl">

              <div className="border-b border-white/10 px-4 py-3">

                <div className="flex items-center justify-between gap-3">

                  <p className="text-xs uppercase tracking-[0.2em] text-gray-500">
                    Search Results
                  </p>

                  <span className="rounded-full bg-blue-500/10 px-2 py-1 text-[10px] text-blue-300">
                    {results.length} found
                  </span>

                </div>

                <p className="mt-1 text-xs text-gray-600">
                  Select the correct location
                </p>

              </div>

              {results.map(
                (
                  place,
                  index
                ) => (

                  <button
                    key={`${place.place_id}-${index}`}
                    type="button"
                    onClick={() =>
                      selectLocation(
                        place
                      )
                    }
                    className="block w-full border-b border-white/10 px-4 py-4 text-left transition last:border-b-0 hover:bg-blue-500/10"
                  >

                    <div className="flex items-start gap-3">

                      <span className="mt-0.5 text-sm">
                        📍
                      </span>

                      <div className="min-w-0">

                        <div className="flex flex-wrap items-center gap-2">

                          <p className="truncate text-sm font-medium text-white">
                            {place.name ||
                              "Location"}
                          </p>

                          {place.type && (

                            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[9px] uppercase tracking-wider text-gray-500">
                              {place.type}
                            </span>

                          )}

                        </div>

                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-500">
                          {place.display_name}
                        </p>

                      </div>

                    </div>

                  </button>

                )
              )}

            </div>

          )}

          {/* ERROR */}

          {error && (

            <div className="mt-3 rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              ⚠️{" "}
              {error}
            </div>

          )}

        </div>

        {/* =================================================
            MAP + SETUP
        ================================================== */}

        <div className="grid items-start gap-6 lg:grid-cols-[1fr_360px]">

          {/* =================================================
              MAP
          ================================================== */}

          <div className="relative self-start overflow-hidden rounded-3xl border border-white/10 bg-black shadow-2xl">

            {/* MAP CONTROLS */}

            <div className="absolute right-4 top-4 z-[1000] flex max-w-[calc(100%-2rem)] flex-wrap justify-end gap-2">

              <div className="flex overflow-hidden rounded-xl border border-white/10 bg-black/85 p-1 shadow-2xl backdrop-blur-xl">

                <button
                  type="button"
                  onClick={() =>
                    setMapType(
                      "street"
                    )
                  }
                  className={`rounded-lg px-3 py-2 text-xs font-medium transition md:px-4 ${
                    mapType ===
                    "street"
                      ? "bg-blue-500 text-white"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  🗺️ Street
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setMapType(
                      "satellite"
                    )
                  }
                  className={`rounded-lg px-3 py-2 text-xs font-medium transition md:px-4 ${
                    mapType ===
                    "satellite"
                      ? "bg-blue-500 text-white"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  🛰️ Satellite
                </button>

              </div>

              {!selectingArea &&
                !areaBounds && (

                <button
                  type="button"
                  onClick={
                    startAreaSelection
                  }
                  className="rounded-xl border border-cyan-400/20 bg-black/85 px-3 py-2 text-xs font-semibold text-cyan-300 shadow-2xl backdrop-blur-xl transition hover:bg-cyan-500/10 md:px-4"
                >
                  ⬜ Select Area
                </button>

              )}

              {selectingArea && (

                <button
                  type="button"
                  onClick={
                    cancelAreaSelection
                  }
                  className="rounded-xl border border-red-400/20 bg-black/85 px-3 py-2 text-xs font-semibold text-red-300 shadow-2xl backdrop-blur-xl transition hover:bg-red-500/10 md:px-4"
                >
                  ✕ Cancel
                </button>

              )}

              {areaBounds && (

                <>

                  <button
                    type="button"
                    onClick={
                      focusArea
                    }
                    className="rounded-xl border border-cyan-400/20 bg-black/85 px-3 py-2 text-xs font-semibold text-cyan-300 shadow-2xl backdrop-blur-xl transition hover:bg-cyan-500/10 md:px-4"
                  >
                    ⛶ Focus AOI
                  </button>

                  <button
                    type="button"
                    onClick={
                      clearArea
                    }
                    className="rounded-xl border border-red-400/20 bg-black/85 px-3 py-2 text-xs font-semibold text-red-300 shadow-2xl backdrop-blur-xl transition hover:bg-red-500/10 md:px-4"
                  >
                    Clear Area
                  </button>

                </>

              )}

            </div>

            {/* AOI INSTRUCTION */}

            {selectingArea && (

              <div className="absolute left-4 top-4 z-[1000] max-w-[280px] rounded-xl border border-cyan-400/20 bg-black/85 px-4 py-3 text-xs text-cyan-300 shadow-2xl backdrop-blur-xl md:max-w-sm">

                <p className="font-semibold">
                  AOI Selection
                </p>

                <p className="mt-1 leading-5 text-cyan-200/70">

                  {areaStart
                    ? "Now click the opposite corner of your analysis area."
                    : "Click the map to select the first corner."}

                </p>

              </div>

            )}

            {/* AOI STATUS */}

            {areaBounds &&
              !selectingArea && (

              <div className="absolute bottom-4 left-4 z-[1000] rounded-xl border border-cyan-400/20 bg-black/85 px-4 py-3 shadow-2xl backdrop-blur-xl">

                <p className="text-[10px] uppercase tracking-[0.2em] text-cyan-300">
                  AOI Selected
                </p>

                <p className="mt-1 text-xs text-gray-300">

                  {areaKm2 <
                    0.01
                    ? `${(
                        areaKm2 *
                        1000000
                      ).toFixed(
                        0
                      )} m²`
                    : `${areaKm2.toFixed(
                        2
                      )} km²`}

                </p>

              </div>

            )}

            {/* MAP */}

            <MapContainer
              center={
                position
              }
              zoom={
                selectedZoom
              }
              minZoom={2}
              maxZoom={19}
              scrollWheelZoom={
                true
              }
              zoomControl={
                true
              }
              doubleClickZoom={
                true
              }
              dragging={
                true
              }
              touchZoom={
                true
              }
              className="h-[520px] w-full md:h-[600px]"
            >

              {mapType ===
              "satellite" ? (

                <TileLayer
                  attribution="Tiles &copy; Esri"
                  url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                />

              ) : (

                <TileLayer
                  attribution="&copy; OpenStreetMap contributors"
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

              )}

              <MapController
                position={
                  position
                }
                zoom={
                  selectedZoom
                }
                areaBounds={
                  areaBounds
                }
              />

              <MapInteraction
                setPosition={
                  setPosition
                }
                setLocationName={
                  setLocationName
                }
                selectingArea={
                  selectingArea
                }
                areaStart={
                  areaStart
                }
                setAreaStart={
                  setAreaStart
                }
                setAreaBounds={
                  setAreaBounds
                }
                setError={
                  setError
                }
                setSatelliteMessage={
                  setSatelliteMessage
                }
              />

              {!selectingArea && (

                <Marker
                  position={
                    position
                  }
                >

                  <Popup>

                    <div className="text-sm">

                      <strong>
                        {locationName}
                      </strong>

                      <br />

                      Latitude:{" "}
                      {position[0].toFixed(
                        6
                      )}

                      <br />

                      Longitude:{" "}
                      {position[1].toFixed(
                        6
                      )}

                    </div>

                  </Popup>

                </Marker>

              )}

              {areaBounds && (

                <Rectangle
                  bounds={
                    areaBounds
                  }
                  pathOptions={{
                    color:
                      "#22d3ee",
                    weight: 2,
                    fillColor:
                      "#22d3ee",
                    fillOpacity:
                      0.15,
                  }}
                />

              )}

              {areaStart && (

                <Marker
                  position={
                    areaStart
                  }
                >

                  <Popup>
                    Area selection start point
                  </Popup>

                </Marker>

              )}

            </MapContainer>

          </div>

          {/* =================================================
              ANALYSIS SETUP
          ================================================== */}

          <div className="rounded-3xl border border-blue-500/20 bg-gradient-to-b from-blue-500/[0.08] to-transparent p-5 backdrop-blur-xl md:p-6">

            {/* HEADER */}

            <div className="flex items-center gap-3">

              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/15 text-2xl">
                📍
              </div>

              <div>

                <h3 className="font-semibold">
                  Analysis Setup
                </h3>

                <p className="text-xs text-gray-500">
                  Location & observation parameters
                </p>

              </div>

            </div>

            {/* LOCATION */}

            <div className="mt-6 rounded-2xl border border-white/10 bg-black/30 p-4">

              <p className="text-xs uppercase tracking-wider text-gray-500">
                Location
              </p>

              <p className="mt-2 line-clamp-4 text-sm font-medium leading-6 text-gray-200">
                {locationName}
              </p>

            </div>

            {/* COORDINATES */}

            <div className="mt-4 grid grid-cols-2 gap-3">

              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">

                <p className="text-xs uppercase tracking-wider text-gray-500">
                  Latitude
                </p>

                <p className="mt-2 text-lg font-semibold text-blue-400">
                  {position[0].toFixed(
                    6
                  )}
                </p>

              </div>

              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">

                <p className="text-xs uppercase tracking-wider text-gray-500">
                  Longitude
                </p>

                <p className="mt-2 text-lg font-semibold text-purple-400">
                  {position[1].toFixed(
                    6
                  )}
                </p>

              </div>

            </div>

            {/* AOI */}

            <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4">

              <div className="flex items-center justify-between gap-2">

                <p className="text-xs uppercase tracking-wider text-gray-500">
                  Analysis Area
                </p>

                {areaBounds && (

                  <span className="rounded-full bg-cyan-400/10 px-2 py-1 text-[10px] text-cyan-300">
                    AOI SELECTED
                  </span>

                )}

              </div>

              {areaBounds ? (

                <>

                  <p className="mt-3 text-xl font-semibold text-cyan-300">

                    {areaKm2 <
                      0.01
                      ? `${(
                          areaKm2 *
                          1000000
                        ).toFixed(
                          0
                        )} m²`
                      : `${areaKm2.toFixed(
                          2
                        )} km²`}

                  </p>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">

                    <div className="rounded-lg bg-white/[0.03] p-2">

                      <span className="text-gray-600">
                        South-West
                      </span>

                      <p className="mt-1 text-gray-400">
                        {areaBounds[0][0].toFixed(
                          4
                        )}
                        ,{" "}
                        {areaBounds[0][1].toFixed(
                          4
                        )}
                      </p>

                    </div>

                    <div className="rounded-lg bg-white/[0.03] p-2">

                      <span className="text-gray-600">
                        North-East
                      </span>

                      <p className="mt-1 text-gray-400">
                        {areaBounds[1][0].toFixed(
                          4
                        )}
                        ,{" "}
                        {areaBounds[1][1].toFixed(
                          4
                        )}
                      </p>

                    </div>

                  </div>

                </>

              ) : (

                <div className="mt-3 rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-3 py-4">

                  <p className="text-sm text-gray-500">
                    No analysis area selected yet.
                  </p>

                  <p className="mt-1 text-[11px] leading-5 text-gray-600">
                    Use “Select Area” and click two opposite corners.
                  </p>

                </div>

              )}

            </div>

            {/* =================================================
                OBSERVATION PERIOD
            ================================================== */}

            <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">

              <p className="text-xs uppercase tracking-wider text-gray-500">
                Observation Period
              </p>

              <div className="mt-4 grid gap-3">

                <div>

                  <label className="mb-2 block text-xs text-gray-500">
                    From Date
                  </label>

                  <input
                    type="date"
                    value={
                      fromDate
                    }
                    max={
                      toDate ||
                      undefined
                    }
                    onChange={(
                      event
                    ) => {
                      const value =
                        event.target
                          .value;

                      setFromDate(
                        value
                      );

                      setSatelliteResults(
                        []
                      );

                      setSatelliteCount(
                        0
                      );

                      setSelectedScene(
                        null
                      );

                      setPreviewImage(
                        ""
                      );

                      setPreviewError(
                        ""
                      );

                      setSatelliteMessage(
                        ""
                      );

                      if (
                        value &&
                        toDate &&
                        value >
                          toDate
                      ) {
                        setDateError(
                          "From Date cannot be later than To Date."
                        );
                      } else {
                        setDateError(
                          ""
                        );
                      }
                    }}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-blue-500/50"
                  />

                </div>

                <div>

                  <label className="mb-2 block text-xs text-gray-500">
                    To Date
                  </label>

                  <input
                    type="date"
                    value={
                      toDate
                    }
                    min={
                      fromDate ||
                      undefined
                    }
                    onChange={(
                      event
                    ) => {
                      const value =
                        event.target
                          .value;

                      setToDate(
                        value
                      );

                      setSatelliteResults(
                        []
                      );

                      setSatelliteCount(
                        0
                      );

                      setSelectedScene(
                        null
                      );

                      setPreviewImage(
                        ""
                      );

                      setPreviewError(
                        ""
                      );

                      setSatelliteMessage(
                        ""
                      );

                      if (
                        fromDate &&
                        value &&
                        value <
                          fromDate
                      ) {
                        setDateError(
                          "To Date cannot be earlier than From Date."
                        );
                      } else {
                        setDateError(
                          ""
                        );
                      }
                    }}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-blue-500/50"
                  />

                </div>

              </div>

              {dateError && (

                <div className="mt-4 rounded-xl border border-red-400/20 bg-red-500/[0.05] px-4 py-3 text-xs leading-5 text-red-300">
                  ⚠️{" "}
                  {dateError}
                </div>

              )}

              {fromDate &&
                toDate &&
                !dateError && (

                <div className="mt-4 rounded-xl border border-blue-400/20 bg-blue-500/[0.05] px-4 py-3">

                  <p className="text-xs text-blue-400">
                    Selected Period
                  </p>

                  <p className="mt-1 text-sm text-gray-300">
                    {fromDate} →{" "}
                    {toDate}
                  </p>

                </div>

              )}

            </div>

            {/* CLOUD */}

            <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">

              <div className="flex items-center justify-between">

                <p className="text-xs uppercase tracking-wider text-gray-500">
                  Cloud Cover
                </p>

                <span className="text-xs font-semibold text-cyan-300">
                  ≤{" "}
                  {maxCloudCover}%
                </span>

              </div>

              <select
                value={
                  maxCloudCover
                }
                onChange={(
                  event
                ) => {
                  const value =
                    Number(
                      event.target
                        .value
                    );

                  setMaxCloudCover(
                    value
                  );

                  setSatelliteResults(
                    []
                  );

                  setSatelliteCount(
                    0
                  );

                  setSelectedScene(
                    null
                  );

                  setPreviewImage(
                    ""
                  );

                  setPreviewError(
                    ""
                  );

                  setSatelliteMessage(
                    ""
                  );
                }}
                className="mt-3 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/50"
              >

                <option value="10">
                  10% — Very Clear
                </option>

                <option value="20">
                  20% — Clear
                </option>

                <option value="30">
                  30% — Recommended
                </option>

                <option value="50">
                  50% — Moderate
                </option>

                <option value="70">
                  70% — Flexible
                </option>

                <option value="100">
                  100% — All Scenes
                </option>

              </select>

              <p className="mt-2 text-[11px] leading-5 text-gray-600">
                Lower cloud cover usually gives
                cleaner optical imagery.
              </p>

            </div>

            {/* STATUS */}

            <div
              className={`mt-6 rounded-2xl border p-4 ${
                isReadyForSatelliteData
                  ? "border-green-400/20 bg-green-400/[0.05]"
                  : dateError
                  ? "border-red-400/20 bg-red-400/[0.05]"
                  : "border-blue-400/20 bg-blue-400/[0.05]"
              }`}
            >

              <p
                className={`text-xs uppercase tracking-wider ${
                  isReadyForSatelliteData
                    ? "text-green-400"
                    : dateError
                    ? "text-red-400"
                    : "text-blue-400"
                }`}
              >

                {isReadyForSatelliteData
                  ? "Analysis Ready"
                  : dateError
                  ? "Date Range Error"
                  : "Setup Progress"}

              </p>

              <p className="mt-2 text-sm leading-6 text-gray-400">

                {isReadyForSatelliteData
                  ? "AOI, date range and cloud filter are ready for Sentinel-2 search."
                  : dateError
                  ? dateError
                  : !areaBounds
                  ? "Select an analysis area to continue."
                  : !fromDate ||
                    !toDate
                  ? "Choose both From Date and To Date to continue."
                  : "Complete the setup to continue."}

              </p>

            </div>

            {/* SEARCH */}

            <button
              type="button"
              disabled={
                !isReadyForSatelliteData ||
                satelliteSearching
              }
              onClick={
                handleSatelliteSearch
              }
              className={`mt-6 w-full rounded-xl py-3.5 text-sm font-semibold transition ${
                isReadyForSatelliteData &&
                !satelliteSearching
                  ? "bg-blue-500 text-white hover:bg-blue-400"
                  : "cursor-not-allowed bg-gray-700 text-gray-500"
              }`}
            >

              {satelliteSearching
                ? "🛰️ Searching Sentinel-2..."
                : "🛰️ Search Satellite Data"}

            </button>

          </div>

        </div>

        {/* =================================================
            SEARCH MESSAGE / ERROR
        ================================================== */}

        {satelliteError && (

          <div className="mt-6 rounded-2xl border border-red-400/20 bg-red-500/[0.06] px-5 py-4 text-sm text-red-300">

            ⚠️{" "}
            {satelliteError}

          </div>

        )}

        {satelliteMessage &&
          !satelliteError && (

          <div className="mt-6 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.05] px-5 py-4 text-sm text-cyan-200">

            🛰️{" "}
            {satelliteMessage}

          </div>

        )}

        {/* =================================================
            SELECTED SCENE
        ================================================== */}

        {selectedScene && (

          <section className="mt-8 overflow-hidden rounded-3xl border border-green-400/20 bg-green-400/[0.04]">

            <div className="border-b border-white/10 px-5 py-5">

              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">

                <div>

                  <p className="text-[10px] uppercase tracking-[0.2em] text-green-400">
                    Selected Sentinel-2 Scene
                  </p>

                  <h3 className="mt-2 break-words text-lg font-semibold text-white md:text-xl">
                    {selectedScene.product_name ||
                      selectedScene.id ||
                      "Sentinel-2 Scene"}
                  </h3>

                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">

                    <span>
                      📅{" "}
                      {formatDate(
                        selectedScene.acquisition_date
                      )}
                    </span>

                    {formatTime(
                      selectedScene.acquisition_date
                    ) && (

                      <span>
                        🕐{" "}
                        {formatTime(
                          selectedScene.acquisition_date
                        )}
                      </span>

                    )}

                    <span>
                      ☁️ Cloud{" "}
                      {formatCloud(
                        selectedScene.cloud_cover
                      )}
                    </span>

                  </div>

                </div>

                <span className="w-fit rounded-full border border-green-400/20 bg-green-400/10 px-4 py-2 text-xs font-semibold text-green-300">
                  ✓ SCENE SELECTED
                </span>

              </div>

              {/* SCENE INFO */}

              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">

                <InfoItem
                  label="Collection"
                  value="Sentinel-2 L2A"
                />

                <InfoItem
                  label="Platform"
                  value={
                    selectedScene.platform ||
                    selectedScene.constellation ||
                    "Sentinel-2"
                  }
                />

                <InfoItem
                  label="Tile"
                  value={
                    selectedScene.mgrs_tile ||
                    "N/A"
                  }
                />

                <InfoItem
                  label="Orbit"
                  value={
                    selectedScene.orbit_state ||
                    "N/A"
                  }
                />

              </div>

              {/* PREVIEW BUTTON */}

              <div className="mt-5 flex flex-col gap-3 sm:flex-row">

                <button
                  type="button"
                  onClick={
                    previewSelectedScene
                  }
                  disabled={
                    previewLoading
                  }
                  className={`rounded-xl px-6 py-3 text-sm font-semibold transition ${
                    previewLoading
                      ? "cursor-not-allowed bg-gray-700 text-gray-500"
                      : "bg-cyan-500 text-white hover:bg-cyan-400"
                  }`}
                >

                  {previewLoading
                    ? "🛰️ Loading Preview..."
                    : "🖼️ Preview Scene"}

                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedScene(
                      null
                    );

                    setPreviewImage(
                      ""
                    );

                    setPreviewError(
                      ""
                    );

                    setSatelliteMessage(
                      "Scene selection cleared."
                    );
                  }}
                  className="rounded-xl border border-white/10 bg-white/5 px-6 py-3 text-sm font-semibold text-gray-300 transition hover:bg-white/10 hover:text-white"
                >
                  Clear Selection
                </button>

              </div>

            </div>

            {/* PREVIEW ERROR */}

            {previewError && (

              <div className="border-b border-white/10 px-5 py-4">

                <div className="rounded-xl border border-red-400/20 bg-red-500/[0.06] px-4 py-3 text-sm leading-6 text-red-300">
                  ⚠️{" "}
                  {previewError}
                </div>

              </div>

            )}

            {/* PREVIEW IMAGE */}

            {previewImage && (

              <div className="p-5">

                <div className="overflow-hidden rounded-2xl border border-cyan-400/20 bg-black/40">

                  <div className="border-b border-white/10 px-5 py-4">

                    <div className="flex flex-col justify-between gap-2 md:flex-row md:items-center">

                      <div>

                        <p className="text-xs uppercase tracking-[0.2em] text-cyan-400">
                          Sentinel-2 Preview
                        </p>

                        <p className="mt-1 text-sm text-gray-400">
                          True-color RGB •{" "}
                          {formatDate(
                            selectedScene.acquisition_date
                          )}
                        </p>

                      </div>

                      <span className="rounded-full bg-cyan-400/10 px-3 py-1.5 text-[10px] font-semibold text-cyan-300">
                        B04 • B03 • B02
                      </span>

                    </div>

                  </div>

                  <div className="bg-black p-3 md:p-5">

                    <img
                      src={
                        previewImage
                      }
                      alt="Sentinel-2 satellite preview"
                      className="mx-auto h-auto max-h-[700px] w-full rounded-xl object-contain"
                    />
                    {/* USE THIS SCENE FOR IMAGE ANALYSIS */}
<div className="mt-5 flex justify-center">
  <button
    type="button"
    onClick={() => {
      if (!selectedScene || !previewImage) {
        setPreviewError(
          "Please generate a satellite preview first."
        );
        return;
      }

      sessionStorage.setItem(
        "satquery_selected_scene",
        JSON.stringify({
          scene: selectedScene,
          previewImage,
          areaBounds,
        })
      );

      window.location.href = "/analysis/image";
    }}
    className="w-full rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 transition hover:from-cyan-400 hover:to-blue-400"
  >
    🔍 Use This Scene for Image Analysis
  </button>
</div>

                  </div>
                  

                </div>
                {/* =========================================================
    CHANGE DETECTION SCENE SELECTION
========================================================= */}

<div className="mt-5 grid gap-3 md:grid-cols-2">

  {/* BEFORE */}
  <button
    type="button"
    onClick={() => {
      if (!selectedScene || !previewImage) {
        setPreviewError(
          "Please generate a satellite preview first."
        );
        return;
      }

      sessionStorage.setItem(
        "satquery_change_before",
        JSON.stringify({
          scene: selectedScene,
          previewImage,
          areaBounds,
        })
      );

      setSatelliteMessage(
        `✅ Before scene selected: ${formatDate(
          selectedScene.acquisition_date
        )}`
      );
    }}
    className="rounded-xl border border-blue-400/20 bg-blue-500/10 px-5 py-3 text-sm font-semibold text-blue-300 transition hover:bg-blue-500/20"
  >
    🕐 Use as Before
  </button>

  {/* AFTER */}
  <button
    type="button"
    onClick={() => {
      if (!selectedScene || !previewImage) {
        setPreviewError(
          "Please generate a satellite preview first."
        );
        return;
      }

      sessionStorage.setItem(
        "satquery_change_after",
        JSON.stringify({
          scene: selectedScene,
          previewImage,
          areaBounds,
        })
      );

      setSatelliteMessage(
        `✅ After scene selected: ${formatDate(
          selectedScene.acquisition_date
        )}`
      );
    }}
    className="rounded-xl border border-purple-400/20 bg-purple-500/10 px-5 py-3 text-sm font-semibold text-purple-300 transition hover:bg-purple-500/20"
  >
    ⚡ Use as After
  </button>

</div>

{/* OPEN CHANGE DETECTION */}
<div className="mt-4 flex justify-center">
  <button
    type="button"
    onClick={() => {
      const before =
        sessionStorage.getItem(
          "satquery_change_before"
        );

      const after =
        sessionStorage.getItem(
          "satquery_change_after"
        );

      if (!before || !after) {
        setPreviewError(
          "Please select both Before and After scenes first."
        );
        return;
      }

      window.location.href =
        "/analysis/change-detection";
    }}
    className="w-full rounded-xl bg-gradient-to-r from-purple-500 to-fuchsia-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition hover:from-purple-400 hover:to-fuchsia-400"
  >
    🔍 Open Change Detection
  </button>
</div>

              </div>

            )}

          </section>

        )}

        {/* =================================================
            RESULTS
        ================================================== */}

        {satelliteResults.length >
          0 && (

          <section className="mt-8">

            <div className="mb-5 flex flex-col justify-between gap-3 md:flex-row md:items-end">

              <div>

                <p className="text-xs uppercase tracking-[0.25em] text-cyan-400">
                  Sentinel-2 Results
                </p>

                <h3 className="mt-2 text-2xl font-bold">
                  Available Scenes
                </h3>

                <p className="mt-2 text-sm text-gray-500">
                  {satelliteCount} matching scene
                  {satelliteCount ===
                  1
                    ? ""
                    : "s"}{" "}
                  found for the selected AOI.
                </p>

              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">

                <p className="text-[10px] uppercase tracking-wider text-gray-600">
                  Filter
                </p>

                <p className="mt-1 text-xs text-gray-400">
                  Cloud ≤{" "}
                  {maxCloudCover}%
                </p>

              </div>

            </div>

            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">

              {satelliteResults.map(
                (
                  scene,
                  index
                ) => {

                  const isSelected =
                    selectedScene?.id ===
                    scene.id;

                  return (

                    <div
                      key={
                        scene.id ||
                        index
                      }
                      className={`group overflow-hidden rounded-2xl border p-5 transition ${
                        isSelected
                          ? "border-green-400/40 bg-green-400/[0.06]"
                          : "border-white/10 bg-white/[0.03] hover:border-cyan-400/20 hover:bg-cyan-400/[0.03]"
                      }`}
                    >

                      {/* TOP */}

                      <div className="flex items-start justify-between gap-3">

                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-400/10 text-xl">
                          🛰️
                        </div>

                        <span
                          className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                            Number(
                              scene.cloud_cover
                            ) <= 20
                              ? "bg-green-400/10 text-green-300"
                              : Number(
                                  scene.cloud_cover
                                ) <=
                                40
                              ? "bg-yellow-400/10 text-yellow-300"
                              : "bg-red-400/10 text-red-300"
                          }`}
                        >
                          Cloud{" "}
                          {formatCloud(
                            scene.cloud_cover
                          )}
                        </span>

                      </div>

                      {/* PRODUCT */}

                      <div className="mt-4">

                        <p className="line-clamp-2 break-words text-sm font-semibold leading-6 text-white">
                          {scene.product_name ||
                            scene.id ||
                            "Sentinel-2 Scene"}
                        </p>

                        <p className="mt-2 text-xs text-cyan-300">
                          {formatDate(
                            scene.acquisition_date
                          )}

                          {formatTime(
                            scene.acquisition_date
                          ) && (
                            <>
                              {" • "}
                              {formatTime(
                                scene.acquisition_date
                              )}
                            </>
                          )}

                        </p>

                      </div>

                      {/* METADATA */}

                      <div className="mt-4 space-y-2 rounded-xl border border-white/5 bg-black/20 p-3">

                        <div className="flex items-center justify-between gap-3">

                          <span className="text-xs text-gray-600">
                            Collection
                          </span>

                          <span className="text-right text-xs text-gray-400">
                            Sentinel-2 L2A
                          </span>

                        </div>

                        {scene.platform && (

                          <div className="flex items-center justify-between gap-3">

                            <span className="text-xs text-gray-600">
                              Platform
                            </span>

                            <span className="text-right text-xs text-gray-400">
                              {scene.platform}
                            </span>

                          </div>

                        )}

                        {scene.mgrs_tile && (

                          <div className="flex items-center justify-between gap-3">

                            <span className="text-xs text-gray-600">
                              Tile
                            </span>

                            <span className="text-right text-xs text-gray-400">
                              {scene.mgrs_tile}
                            </span>

                          </div>

                        )}

                        {scene.orbit_state && (

                          <div className="flex items-center justify-between gap-3">

                            <span className="text-xs text-gray-600">
                              Orbit
                            </span>

                            <span className="text-right text-xs uppercase text-gray-400">
                              {scene.orbit_state}
                            </span>

                          </div>

                        )}

                      </div>

                      {/* ACTION */}

                      <button
                        type="button"
                        onClick={() =>
                          selectScene(
                            scene
                          )
                        }
                        className={`mt-4 w-full rounded-xl py-3 text-xs font-semibold transition ${
                          isSelected
                            ? "bg-green-500 text-white"
                            : "border border-cyan-400/20 bg-cyan-400/5 text-cyan-300 hover:bg-cyan-400/10"
                        }`}
                      >

                        {isSelected
                          ? "✓ Selected"
                          : "Select Scene"}

                      </button>

                    </div>

                  );
                }
              )}

            </div>

          </section>

        )}

        {/* =================================================
            NO RESULTS
        ================================================== */}

        {!satelliteSearching &&
          satelliteCount ===
            0 &&
          satelliteMessage &&
          !satelliteError &&
          isReadyForSatelliteData && (

          <div className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center">

            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 text-2xl">
              🛰️
            </div>

            <h3 className="mt-4 text-lg font-semibold text-gray-200">
              No matching scenes
            </h3>

            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-gray-500">
              Try a wider date range or
              increase the cloud-cover
              limit.
            </p>

          </div>

        )}

        {/* =================================================
            WORKFLOW
        ================================================== */}

        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5">

          <p className="text-xs uppercase tracking-[0.2em] text-gray-500">
            Workflow
          </p>

          <div className="mt-4 grid gap-4 md:grid-cols-5">

            <Step
              number="01"
              title="Search"
              text="Search for a city, state, country or place."
            />

            <Step
              number="02"
              title="Select Point"
              text="Choose the correct location or click the map."
            />

            <Step
              number="03"
              title="Draw AOI"
              text="Select two opposite corners of the analysis area."
            />

            <Step
              number="04"
              title="Set Filters"
              text="Choose dates and maximum cloud cover."
            />

            <Step
              number="05"
              title="Select Scene"
              text="Find a Sentinel-2 scene and preview it."
            />

          </div>

        </div>

      </main>

    </div>
  );
}

/* =========================================================
   INFO ITEM
========================================================= */

function InfoItem({
  label,
  value,
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-black/20 p-3">

      <p className="text-[10px] uppercase tracking-wider text-gray-600">
        {label}
      </p>

      <p className="mt-1 truncate text-xs font-medium text-gray-300">
        {value}
      </p>

    </div>
  );
}

/* =========================================================
   STEP CARD
========================================================= */

function Step({
  number,
  title,
  text,
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">

      <p className="text-xs font-semibold text-blue-400">
        {number}
      </p>

      <h4 className="mt-2 font-medium">
        {title}
      </h4>

      <p className="mt-1 text-xs leading-5 text-gray-500">
        {text}
      </p>

    </div>
  );
}