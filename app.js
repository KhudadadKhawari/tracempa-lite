"use strict";

const tracerouteInput = document.getElementById("tracerouteInput");
const sourceLatInput = document.getElementById("sourceLat");
const sourceLngInput = document.getElementById("sourceLng");
const sourceLabelInput = document.getElementById("sourceLabel");

const visualizeBtn = document.getElementById("visualizeBtn");
const clearBtn = document.getElementById("clearBtn");
const exampleBtn = document.getElementById("exampleBtn");

const statusMessage = document.getElementById("statusMessage");
const hopTableBody = document.getElementById("hopTableBody");
const failedList = document.getElementById("failedList");
const hopCount = document.getElementById("hopCount");

const geoCache = new Map();

const map = L.map("map", {
  zoomControl: true,
  worldCopyJump: true
}).setView([20, 0], 2);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

let markerLayer = L.layerGroup().addTo(map);
let routeLine = null;

const EXAMPLE_TRACE = `traceroute to google.com (142.250.190.78), 30 hops max
 1  192.168.1.1  1.123 ms  0.932 ms  0.901 ms
 2  10.10.0.1  4.211 ms  4.002 ms  3.991 ms
 3  8.8.8.8  20.214 ms  21.332 ms  19.921 ms
 4  1.1.1.1  35.011 ms  34.600 ms  35.222 ms
 5  142.250.190.78  40.223 ms  41.100 ms  39.890 ms`;

visualizeBtn.addEventListener("click", visualizeRoute);
clearBtn.addEventListener("click", clearAll);
exampleBtn.addEventListener("click", loadExample);

function loadExample() {
  tracerouteInput.value = EXAMPLE_TRACE;
  sourceLatInput.value = "34.5553";
  sourceLngInput.value = "69.2075";
  sourceLabelInput.value = "Kabul";
  setStatus("Example loaded. Click Visualize Route.");
}

function clearAll() {
  tracerouteInput.value = "";
  sourceLatInput.value = "";
  sourceLngInput.value = "";
  sourceLabelInput.value = "";

  clearMap();
  renderTable([]);
  renderFailedList([]);
  setStatus("Ready.");
  hopCount.textContent = "0 hops";
}

async function visualizeRoute() {
  const rawText = tracerouteInput.value.trim();

  if (!rawText) {
    setStatus("Paste traceroute output first.");
    return;
  }

  clearMap();
  renderTable([]);
  renderFailedList([]);

  visualizeBtn.disabled = true;

  try {
    setStatus("Parsing traceroute output...");

    const parsedHops = parseTraceroute(rawText);
    hopCount.textContent = `${parsedHops.length} hops`;

    if (!parsedHops.length) {
      setStatus("No valid traceroute hops found.");
      renderTable([]);
      return;
    }

    const publicHops = parsedHops.filter((hop) => hop.shouldLookup);

    setStatus(`Found ${publicHops.length} public IPs. Looking up IP locations...`);

    for (let i = 0; i < publicHops.length; i += 1) {
      const hop = publicHops[i];
      setStatus(`Looking up IP locations... ${i + 1}/${publicHops.length}: ${hop.ip}`);

      const geo = await lookupGeoIp(hop.ip);

      if (geo) {
        hop.geo = geo;
        hop.status = "Mapped";
      } else {
        hop.status = "GeoIP failed";
      }

      renderTable(parsedHops);

      if (i < publicHops.length - 1) {
        await delay(1350);
      }
    }

    setStatus("Drawing route...");

    const sourcePoint = getSourcePoint();
    const mappedHops = parsedHops.filter((hop) => hop.geo);
    drawRoute(sourcePoint, mappedHops);

    renderTable(parsedHops);
    renderFailedList(parsedHops);

    setStatus("Done.");
  } catch (error) {
    console.error(error);
    setStatus(`Error: ${error.message || "Something went wrong."}`);
  } finally {
    visualizeBtn.disabled = false;
  }
}

function parseTraceroute(text) {
  const lines = text.split(/\r?\n/);
  const hops = [];
  const seenPublicIps = new Set();

  for (const line of lines) {
    const hopMatch = line.match(/^\s*(\d+)\s+(.+)$/);

    if (!hopMatch) {
      continue;
    }

    const hopNumber = Number.parseInt(hopMatch[1], 10);
    const rest = hopMatch[2].trim();

    const ipv4s = extractIPv4s(rest);
    const latencyValues = extractLatencyValues(rest);
    const avgLatency = averageLatency(latencyValues);

    if (isNoResponseHop(rest, ipv4s)) {
      hops.push({
        hop: hopNumber,
        ip: "",
        hostname: "",
        latencies: latencyValues,
        avgLatency,
        status: "No response",
        shouldLookup: false
      });
      continue;
    }

    if (!ipv4s.length) {
      const hasIPv6 = containsPossibleIPv6(rest);

      hops.push({
        hop: hopNumber,
        ip: "",
        hostname: "",
        latencies: latencyValues,
        avgLatency,
        status: hasIPv6 ? "IPv6 skipped" : "No public IP found",
        shouldLookup: false
      });
      continue;
    }

    const publicIp = ipv4s.find(isPublicIPv4);
    const selectedIp = publicIp || ipv4s[0];

    const hostname = extractHostname(rest, selectedIp);

    if (!publicIp) {
      hops.push({
        hop: hopNumber,
        ip: selectedIp,
        hostname,
        latencies: latencyValues,
        avgLatency,
        status: "Private IP skipped",
        shouldLookup: false
      });
      continue;
    }

    if (seenPublicIps.has(publicIp)) {
      hops.push({
        hop: hopNumber,
        ip: publicIp,
        hostname,
        latencies: latencyValues,
        avgLatency,
        status: "Duplicate public IP skipped",
        shouldLookup: false
      });
      continue;
    }

    seenPublicIps.add(publicIp);

    hops.push({
      hop: hopNumber,
      ip: publicIp,
      hostname,
      latencies: latencyValues,
      avgLatency,
      status: "Pending",
      shouldLookup: true
    });
  }

  return hops;
}

function extractIPv4s(text) {
  const matches = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || [];

  return matches.filter((ip) => {
    const parts = ip.split(".").map(Number);
    return parts.length === 4 && parts.every((part) => part >= 0 && part <= 255);
  });
}

function extractLatencyValues(text) {
  const values = [];
  const latencyRegex = /<?\s*(\d+(?:\.\d+)?)\s*ms/gi;
  let match;

  while ((match = latencyRegex.exec(text)) !== null) {
    values.push(Number.parseFloat(match[1]));
  }

  return values;
}

function averageLatency(values) {
  if (!values.length) {
    return null;
  }

  const sum = values.reduce((total, value) => total + value, 0);
  return Math.round((sum / values.length) * 100) / 100;
}

function isNoResponseHop(text, ipv4s) {
  const starCount = (text.match(/\*/g) || []).length;
  return starCount > 0 && ipv4s.length === 0;
}

function containsPossibleIPv6(text) {
  return /(?:[a-f0-9]{0,4}:){2,}[a-f0-9]{0,4}/i.test(text);
}

function extractHostname(text, ip) {
  if (!ip) {
    return "";
  }

  let beforeIp = text.split(ip)[0] || "";

  beforeIp = beforeIp
    .replace(/<?\s*\d+(?:\.\d+)?\s*ms/gi, " ")
    .replace(/\*/g, " ")
    .replace(/[[(]/g, " ")
    .trim();

  if (!beforeIp) {
    return "";
  }

  const parts = beforeIp.split(/\s+/);
  const candidate = parts[parts.length - 1];

  if (!candidate || candidate === ip || /^\d+$/.test(candidate)) {
    return "";
  }

  return candidate;
}

function isPublicIPv4(ip) {
  const [a, b, c, d] = ip.split(".").map(Number);

  if ([a, b, c, d].some((part) => Number.isNaN(part))) return false;

  if (a === 0) return false;
  if (a === 10) return false;
  if (a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;

  if (a === 100 && b >= 64 && b <= 127) return false;

  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;

  if (a === 198 && (b === 18 || b === 19)) return false;

  if (a >= 224) return false;
  if (a === 255 && b === 255 && c === 255 && d === 255) return false;

  return true;
}

async function lookupGeoIp(ip) {
  if (geoCache.has(ip)) {
    return geoCache.get(ip);
  }

  const fields = [
    "status",
    "message",
    "country",
    "regionName",
    "city",
    "lat",
    "lon",
    "isp",
    "as",
    "query"
  ].join(",");

  const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=${fields}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      geoCache.set(ip, null);
      return null;
    }

    const data = await response.json();

    if (data.status !== "success" || typeof data.lat !== "number" || typeof data.lon !== "number") {
      geoCache.set(ip, null);
      return null;
    }

    const normalized = {
      ip: data.query || ip,
      city: data.city || "",
      region: data.regionName || "",
      country: data.country || "",
      lat: data.lat,
      lon: data.lon,
      isp: data.isp || "",
      asn: data.as || ""
    };

    geoCache.set(ip, normalized);
    return normalized;
  } catch (error) {
    console.warn(`GeoIP lookup failed for ${ip}`, error);
    geoCache.set(ip, null);
    return null;
  }
}

function getSourcePoint() {
  const latRaw = sourceLatInput.value.trim();
  const lngRaw = sourceLngInput.value.trim();

  if (!latRaw && !lngRaw) {
    return null;
  }

  const lat = Number.parseFloat(latRaw);
  const lng = Number.parseFloat(lngRaw);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    setStatus("Invalid source latitude/longitude. Drawing route without source point.");
    return null;
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    setStatus("Source latitude/longitude is out of range. Drawing route without source point.");
    return null;
  }

  return {
    label: sourceLabelInput.value.trim() || "Source",
    lat,
    lon: lng
  };
}

function drawRoute(sourcePoint, mappedHops) {
  clearMap();

  const routePoints = [];

  if (sourcePoint) {
    routePoints.push({
      type: "source",
      label: sourcePoint.label,
      lat: sourcePoint.lat,
      lon: sourcePoint.lon
    });
  }

  mappedHops.forEach((hop, index) => {
    routePoints.push({
      type: index === mappedHops.length - 1 ? "destination" : "hop",
      hop
    });
  });

  if (!routePoints.length) {
    map.setView([20, 0], 2);
    return;
  }

  const latLngs = [];

  routePoints.forEach((point) => {
    let lat;
    let lon;

    if (point.type === "source") {
      lat = point.lat;
      lon = point.lon;
    } else {
      lat = point.hop.geo.lat;
      lon = point.hop.geo.lon;
    }

    latLngs.push([lat, lon]);

    const marker = createRouteMarker(point, lat, lon);
    markerLayer.addLayer(marker);
  });

  if (latLngs.length >= 2) {
    routeLine = L.polyline(latLngs, {
      color: "#38bdf8",
      weight: 3,
      opacity: 0.85,
      dashArray: "8 8"
    }).addTo(map);
  }

  const bounds = L.latLngBounds(latLngs);

  if (latLngs.length === 1) {
    map.setView(latLngs[0], 5);
  } else {
    map.fitBounds(bounds, {
      padding: [36, 36],
      maxZoom: 6
    });
  }
}

function createRouteMarker(point, lat, lon) {
  const style = getMarkerStyle(point.type);
  const marker = L.circleMarker([lat, lon], style);

  if (point.type === "source") {
    marker.bindPopup(`
      <div class="popup-title">Source</div>
      <div class="popup-row"><strong>Label:</strong> ${escapeHtml(point.label)}</div>
      <div class="popup-row"><strong>Latitude:</strong> ${lat}</div>
      <div class="popup-row"><strong>Longitude:</strong> ${lon}</div>
    `);

    return marker;
  }

  const hop = point.hop;
  const geo = hop.geo;

  marker.bindPopup(`
    <div class="popup-title">
      ${point.type === "destination" ? "Destination" : "Hop"} ${hop.hop}
    </div>
    <div class="popup-row"><strong>IP:</strong> ${escapeHtml(hop.ip)}</div>
    <div class="popup-row"><strong>Hostname:</strong> ${escapeHtml(hop.hostname || "-")}</div>
    <div class="popup-row"><strong>Location:</strong> ${escapeHtml(formatLocation(geo))}</div>
    <div class="popup-row"><strong>ISP:</strong> ${escapeHtml(geo.isp || "-")}</div>
    <div class="popup-row"><strong>ASN:</strong> ${escapeHtml(geo.asn || "-")}</div>
    <div class="popup-row"><strong>Avg latency:</strong> ${formatLatency(hop.avgLatency)}</div>
  `);

  return marker;
}

function getMarkerStyle(type) {
  if (type === "source") {
    return {
      radius: 8,
      color: "#22c55e",
      fillColor: "#22c55e",
      fillOpacity: 0.9,
      weight: 2
    };
  }

  if (type === "destination") {
    return {
      radius: 9,
      color: "#fb7185",
      fillColor: "#fb7185",
      fillOpacity: 0.95,
      weight: 2
    };
  }

  return {
    radius: 7,
    color: "#38bdf8",
    fillColor: "#38bdf8",
    fillOpacity: 0.85,
    weight: 2
  };
}

function clearMap() {
  markerLayer.clearLayers();

  if (routeLine) {
    map.removeLayer(routeLine);
    routeLine = null;
  }
}

function renderTable(hops) {
  if (!hops.length) {
    hopTableBody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-row">No route visualized yet.</td>
      </tr>
    `;
    hopCount.textContent = "0 hops";
    return;
  }

  hopCount.textContent = `${hops.length} hops`;

  hopTableBody.innerHTML = hops
    .map((hop) => {
      const location = hop.geo ? formatLocation(hop.geo) : "-";
      const ispAsn = hop.geo ? formatIspAsn(hop.geo) : "-";

      return `
        <tr>
          <td>${hop.hop}</td>
          <td>${escapeHtml(hop.ip || "-")}</td>
          <td>${escapeHtml(hop.hostname || "-")}</td>
          <td>${escapeHtml(location)}</td>
          <td>${escapeHtml(ispAsn)}</td>
          <td>${formatLatency(hop.avgLatency)}</td>
          <td>${statusBadge(hop.status)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderFailedList(hops) {
  const failed = hops.filter((hop) =>
    [
      "GeoIP failed",
      "No response",
      "No public IP found",
      "IPv6 skipped"
    ].includes(hop.status)
  );

  if (!failed.length) {
    failedList.innerHTML = "<li>No failed lookups yet.</li>";
    return;
  }

  failedList.innerHTML = failed
    .map((hop) => {
      const ip = hop.ip || "No IP";
      return `<li>Hop ${hop.hop}: ${escapeHtml(ip)} — ${escapeHtml(hop.status)}</li>`;
    })
    .join("");
}

function statusBadge(status) {
  const normalized = status || "Pending";

  let className = "neutral";

  if (normalized === "Mapped") {
    className = "mapped";
  } else if (
    normalized.includes("skipped") ||
    normalized === "Private IP skipped" ||
    normalized === "IPv6 skipped"
  ) {
    className = "skipped";
  } else if (
    normalized === "GeoIP failed" ||
    normalized === "No response" ||
    normalized === "No public IP found"
  ) {
    className = "failed";
  }

  return `<span class="badge ${className}">${escapeHtml(normalized)}</span>`;
}

function formatLocation(geo) {
  return [geo.city, geo.region, geo.country].filter(Boolean).join(", ") || "-";
}

function formatIspAsn(geo) {
  return [geo.isp, geo.asn].filter(Boolean).join(" / ") || "-";
}

function formatLatency(value) {
  if (value === null || value === undefined) {
    return "-";
  }

  return `${value} ms`;
}

function setStatus(message) {
  statusMessage.textContent = message;
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
