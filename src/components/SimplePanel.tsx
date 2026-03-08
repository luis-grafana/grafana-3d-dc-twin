import React, { useRef, useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { PanelProps, PanelData, FieldType } from '@grafana/data';
import { locationService } from '@grafana/runtime';
import { SimpleOptions } from '../types';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { IconButton, ClickOutsideWrapper } from '@grafana/ui';

import './ControlPanel.css';

interface Props extends PanelProps<SimpleOptions> {}

type TextureStyle = 'none' | 'checker' | 'dots' | 'stripes' | 'glossy';

const VALID_TEXTURE_STYLES: TextureStyle[] = ['none', 'checker', 'dots', 'stripes', 'glossy'];

function getEffectiveTextureStyle(value: string | undefined): TextureStyle {
  if (value != null && VALID_TEXTURE_STYLES.includes(value as TextureStyle)) {
    return value as TextureStyle;
  }
  return 'none';
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#14b8a6');
  return result
    ? {
        r: parseInt(result[1], 16) / 255,
        g: parseInt(result[2], 16) / 255,
        b: parseInt(result[3], 16) / 255,
      }
    : { r: 0.08, g: 0.72, b: 0.65 };
}

function applyGradientToGeometry(
  geometry: THREE.BufferGeometry,
  bottomHex: string,
  topHex: string
): void {
  const pos = geometry.getAttribute('position');
  if (!pos) {
    return;
  }
  const count = pos.count;
  const bottom = hexToRgb(bottomHex);
  const top = hexToRgb(topHex);

  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < count; i++) {
    const y = pos.getY(i);
    if (y < minY) {
      minY = y;
    }
    if (y > maxY) {
      maxY = y;
    }
  }
  const range = maxY - minY || 1;

  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const y = pos.getY(i);
    const t = (y - minY) / range;
    colors[i * 3 + 0] = bottom.r + (top.r - bottom.r) * t;
    colors[i * 3 + 1] = bottom.g + (top.g - bottom.g) * t;
    colors[i * 3 + 2] = bottom.b + (top.b - bottom.b) * t;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

const PATTERN_STYLES = ['checker', 'dots', 'stripes'] as const;
type PatternStyle = (typeof PATTERN_STYLES)[number];

function createPatternTexture(style: PatternStyle): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  // Base: white (full material color)
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  // Pattern: darker areas (0.4 = 40% of material color for clear visibility)
  ctx.fillStyle = 'rgba(0,0,0,0.6)';

  if (style === 'checker') {
    const step = 16;
    for (let y = 0; y < size; y += step) {
      for (let x = 0; x < size; x += step) {
        if ((Math.floor(x / step) + Math.floor(y / step)) % 2 === 0) {
          ctx.fillRect(x, y, step, step);
        }
      }
    }
  } else if (style === 'dots') {
    const step = 12;
    const r = 4;
    for (let y = step; y < size; y += step) {
      for (let x = step; x < size; x += step) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (style === 'stripes') {
    const stripeW = 10;
    for (let x = 0; x < size; x += stripeW * 2) {
      ctx.fillRect(x, 0, stripeW, size);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const GRID_SIZE = 80;
const GRID_DIVISIONS = 80;

// Data center layout: derived from data (series count) + panel options. No backend-specific constants.
const RACK_SPACING_X = 3.2;
const RACK_SPACING_Z = 4.5;
const RACK_WIDTH = 1.15;
const RACK_DEPTH = 0.75;
const SERVER_WIDTH = 0.92;
const SERVER_HEIGHT = 0.28;
const SERVER_DEPTH = 0.58;
const SERVER_SLOT_GAP = 0.08;
const SERVER_RADIUS = 0.03;

const NETWORK_LINE_RADIUS = 0.04;
const NETWORK_LINE_COLOR = 0x00d4ff;
const NODE_RADIUS = 0.12;
const NODE_COLOR = 0x00ffff;
/** Height above top of rack for network lines/nodes (added to rackHeight so they sit above servers). */
const NETWORK_ELEVATION_ABOVE_RACK = 0.25;
/** Reset view = full distance (1.0). Intro zoom ends here (a little zoomed in, centered). */
const RESET_VIEW_DISTANCE_SCALE = 1.0;
const INTRO_ZOOM_END_SCALE = 0.88;
const INTRO_ZOOM_DURATION_S = 1.2;

/** 2D view: ortho camera above and in front so servers are visible and clickable (not pure top-down). */
const ORTHO_2D_Y = 14;
const ORTHO_2D_Z = 7;
const ORTHO_2D_POLAR = Math.acos(ORTHO_2D_Y / Math.sqrt(ORTHO_2D_Y * ORTHO_2D_Y + ORTHO_2D_Z * ORTHO_2D_Z));
const ORTHO_2D_HALF = 8;

/** Build network edges from rack count and racks-per-row: ring per row + vertical links between rows. */
function buildNetworkEdges(numRacks: number, racksPerRow: number): Array<[number, number]> {
  const edges: Array<[number, number]> = [];
  const numRows = Math.ceil(numRacks / racksPerRow);
  for (let row = 0; row < numRows; row++) {
    const start = row * racksPerRow;
    const count = Math.min(racksPerRow, numRacks - start);
    for (let i = 0; i < count; i++) {
      const a = start + i;
      const b = start + (i + 1) % count;
      if (b < numRacks) {
        edges.push([a, b]);
      }
    }
    if (row + 1 < numRows) {
      for (let c = 0; c < racksPerRow && start + c < numRacks; c++) {
        const next = start + racksPerRow + c;
        if (next < numRacks) {
          edges.push([start + c, next]);
        }
      }
    }
  }
  return edges;
}

const FLUCTUATION_INTERVAL_MS = 1500;
const ANOMALY_INTERVAL_MIN_MS = 15000;
const ANOMALY_INTERVAL_MAX_MS = 30000;
const ANOMALY_ALERT_DURATION_MS = 5000;
const CAMERA_FLY_DURATION_MS = 1500;

interface SimulatedMetric {
  cpu: number;
  temperature: number;
  memory: number;
  alert: boolean;
  /** When set, use this for dashboard links (from series label) so the target dashboard finds the series. */
  serverIdFromLabel?: number;
}

function randomMetric(): SimulatedMetric {
  return {
    cpu: 0.3 + Math.random() * 0.5,
    temperature: 0.2 + Math.random() * 0.5,
    memory: 0.4 + Math.random() * 0.4,
    alert: false,
  };
}

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

/** Normalize value that might be 0-100 (e.g. CPU %) or 0-1 to 0-1. */
function normalizeMetricValue(v: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    return 0.5;
  }
  return clamp(n > 1 ? n / 100 : n, 0, 1);
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
const SERVER_ROUND_SEGMENTS = 2;
const DEFAULT_BAR_SHARPNESS = 0.76;
function barSharpnessToRadius(sharpness: number): number {
  return (1 - Math.max(0, Math.min(1, sharpness))) * 0.5;
}
const DEFAULT_BAR_COLOR = '#14b8a6';
/** Medium slate gray: clearly visible on black; reads as pro server-rack. */
const RACK_FRAME_COLOR = 0x6e7582;
const FOG_DENSITY = 0.028;
const FOG_COLOR = 0x1a1a24;
const LERP_SPEED = 5;

function getEffectiveBarColor(barColor: string | undefined): string {
  const s = barColor && String(barColor).trim();
  return s && s.startsWith('#') ? s : DEFAULT_BAR_COLOR;
}

/** Map temperature 0–1 to RGB (blue → green → yellow → red). */
function temperatureToColor(temp: number): { r: number; g: number; b: number } {
  const t = clamp(temp, 0, 1);
  const hue = (1 - t) * 0.67;
  const c = new THREE.Color().setHSL(hue, 0.75, 0.48);
  return { r: c.r, g: c.g, b: c.b };
}

/**
 * Parse Grafana data into server metrics for the 3D twin.
 * When the data provides server_id (e.g. Prometheus labels, or a table column), that is the source of truth
 * for display and links. When not provided (table without server_id column, or wide format), we fall back to layout index.
 * - Non-simulation: display only what the DC sends (alerts from backend metrics; no inference).
 * - Simulation: allow derived/fake temp/memory/alert from CPU for demo.
 */
function parseGrafanaData(data: PanelData, simulationMode: boolean): SimulatedMetric[] | null {
  const series = data?.series;
  if (!series?.length) {
    return null;
  }

  const result: SimulatedMetric[] = [];
  const deriveFromCpu = simulationMode; // only true in simulation mode; otherwise DC-only

  // Mode 1: Multiple frames = one or more series per server (e.g. 4 queries = cpu/temp/memory/alert).
  if (series.length > 1) {
    const nameLower = (s: string) => (s ?? '').toLowerCase().trim();
    /** Prometheus/Grafana often use "metric_name{labels}"; take the part before "{" for reliable detection. */
    const metricBase = (raw: string) => nameLower((raw ?? '').split('{')[0].trim());
    type ServerMetrics = { cpu?: number; temperature?: number; memory?: number; alert?: boolean; serverIdFromLabel?: number };
    const byServer = new Map<number, ServerMetrics>();

    const refIds: string[] = [];
    const refIdToIndex: Record<string, number> = {};
    for (const frame of series) {
      const refId = (frame as { refId?: string }).refId;
      if (refId && refIdToIndex[refId] === undefined) {
        refIdToIndex[refId] = refIds.length;
        refIds.push(refId);
      }
    }
    const refIdOrderMetric: (keyof ServerMetrics)[] = ['cpu', 'temperature', 'memory', 'alert'];

    for (const frame of series) {
      const numField = frame.fields.find((f) => f.type === FieldType.number);
      if (!numField) continue;
      const serverIdRaw = numField.labels?.server_id;
      const serverId = serverIdRaw != null ? parseInt(String(serverIdRaw), 10) : -1;
      if (!Number.isFinite(serverId) || serverId < 0) continue;
      const values = numField.values;
      const lastVal =
        values?.length != null && values.length > 0 ? Number(values[values.length - 1]) : 0.5;
      const v = normalizeMetricValue(lastVal);
      const rawName =
        (numField.labels as Record<string, string> | undefined)?.__name__ ??
        (frame as { name?: string }).name ??
        numField.name ??
        '';
      const label = metricBase(rawName) + nameLower(numField.name ?? '');
      let entry = byServer.get(serverId);
      if (!entry) {
        entry = { serverIdFromLabel: serverId };
        byServer.set(serverId, entry);
      }
      const refId = (frame as { refId?: string }).refId;
      const refIdx = refId != null ? refIdToIndex[refId] : -1;
      const useRefIdOrder = refIds.length === 4 && refIdx >= 0 && refIdx < 4;

      if (label.includes('temperature') || label.includes('temp') || (useRefIdOrder && refIdOrderMetric[refIdx] === 'temperature')) {
        entry.temperature = v;
      } else if (label.includes('memory') || label.includes('mem') || (useRefIdOrder && refIdOrderMetric[refIdx] === 'memory')) {
        entry.memory = v;
      } else if (label.includes('alert') || label.includes('alarm') || (useRefIdOrder && refIdOrderMetric[refIdx] === 'alert')) {
        entry.alert = v >= 0.5;
      } else {
        entry.cpu = v;
      }
    }

    const sortedIds = [...byServer.keys()].sort((a, b) => a - b);
    for (const serverId of sortedIds) {
      const e = byServer.get(serverId)!;
      const cpu = e.cpu ?? 0.5;
      result.push({
        cpu,
        temperature: e.temperature ?? (deriveFromCpu ? cpu * 0.7 + 0.2 : 0.5),
        memory: e.memory ?? (deriveFromCpu ? cpu * 0.8 + 0.1 : 0.5),
        alert: e.alert ?? (deriveFromCpu ? cpu >= 0.88 : false),
        serverIdFromLabel: e.serverIdFromLabel,
      });
    }
    return result.length > 0 ? result : null;
  }

  // Mode 2: Single frame - table (rows = servers) or wide (each numeric field = server)
  const frame = series[0];
  if (!frame.fields?.length || frame.length === 0) {
    return null;
  }

  const timeField = frame.fields.find((f) => f.type === FieldType.time);
  const numericFields = frame.fields.filter((f) => f.type === FieldType.number);

  const nameLower = (name: string) => name.toLowerCase().trim();
  const cpuField = frame.fields.find(
    (f) =>
      f.type === FieldType.number &&
      (nameLower(f.name).includes('cpu') || nameLower(f.name) === 'value')
  );
  const tempField = frame.fields.find(
    (f) =>
      f.type === FieldType.number &&
      (nameLower(f.name).includes('temp') || nameLower(f.name).includes('temperature'))
  );
  const memField = frame.fields.find(
    (f) =>
      f.type === FieldType.number &&
      (nameLower(f.name).includes('mem') || nameLower(f.name).includes('memory'))
  );
  const alertField = frame.fields.find(
    (f) =>
      f.type === FieldType.number &&
      (nameLower(f.name).includes('alert') || nameLower(f.name).includes('alarm'))
  );

  // Table by row: each row is a server, columns = cpu, temp, memory, alert (and optionally server_id)
  if (cpuField || tempField || memField || alertField) {
    const len = frame.length;
    const serverIdField = frame.fields.find((f) => nameLower(f.name) === 'server_id' || nameLower(f.name) === 'id')
      ?? frame.fields.find((f) => nameLower(f.name).includes('server') && nameLower(f.name).includes('id'));
    for (let row = 0; row < len; row++) {
      const cpu = cpuField
        ? normalizeMetricValue(Number(cpuField.values[row]) ?? 0.5)
        : 0.5;
      const temp = tempField
        ? normalizeMetricValue(Number(tempField.values[row]) ?? 0.5)
        : (deriveFromCpu ? cpu * 0.6 + 0.2 : 0.5);
      const mem = memField
        ? normalizeMetricValue(Number(memField.values[row]) ?? 0.5)
        : (deriveFromCpu ? cpu * 0.7 + 0.2 : 0.5);
      const alertVal = alertField ? Number(alertField.values[row]) : (deriveFromCpu && cpu >= 0.88 ? 1 : 0);
      let serverIdFromLabel: number | undefined;
      if (serverIdField?.values?.[row] != null) {
        const parsed = parseInt(String(serverIdField.values[row]), 10);
        serverIdFromLabel = Number.isFinite(parsed) ? parsed : undefined;
      }
      result.push({
        cpu,
        temperature: temp,
        memory: mem,
        alert: alertVal > 0.5,
        serverIdFromLabel,
      });
    }
    return result.length > 0 ? result : null;
  }

  // Wide: each numeric field (except time) = one server; no server_id in this shape, UI falls back to layout index.
  if (timeField && numericFields.length > 0) {
    for (let i = 0; i < numericFields.length; i++) {
      const values = numericFields[i].values;
      const lastVal =
        values?.length != null && values.length > 0
          ? Number(values[values.length - 1])
          : 0.5;
      const v = normalizeMetricValue(lastVal);
      result.push({
        cpu: v,
        temperature: deriveFromCpu ? v * 0.7 + 0.2 : 0.5,
        memory: deriveFromCpu ? v * 0.8 + 0.1 : 0.5,
        alert: deriveFromCpu ? v >= 0.88 : false,
      });
    }
    return result.length > 0 ? result : null;
  }

  return null;
}

const SimplePanel: React.FC<Props> = ({ options, width, height, onOptionsChange, data, replaceVariables }) => {
  const effectiveBarColor = getEffectiveBarColor(options.barColor);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sectionsOpen, setSectionsOpen] = useState<Record<string, boolean>>({
    lighting: false,
    appearance: false,
    scene: false,
    layout: false,
    camera: false,
    simulation: false,
  });
  const defaultCount = options.defaultServerCount ?? 64;
  const [simulatedMetrics, setSimulatedMetrics] = useState<SimulatedMetric[]>(() =>
    Array.from({ length: defaultCount }, randomMetric)
  );
  const [hoveredServerIndex, setHoveredServerIndex] = useState<number | null>(null);
  const [hoveredLinkEdge, setHoveredLinkEdge] = useState<number | null>(null);
  const [hoveredNodeRack, setHoveredNodeRack] = useState<number | null>(null);
  const [hoveredRackIndex, setHoveredRackIndex] = useState<number | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null);
  const [selectedServerIndex, setSelectedServerIndex] = useState<number | null>(null);
  const [selectedNodeRack, setSelectedNodeRack] = useState<number | null>(null);
  const [selectedTooltipPosition, setSelectedTooltipPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [showServerDetailsExpanded, setShowServerDetailsExpanded] = useState(false);
  const [alertsListOpen, setAlertsListOpen] = useState(false);
  /** One-time intro zoom-in on load; when true we never run or repeat the zoom. */
  const introZoomDoneRef = useRef(false);
  const introZoomProgressRef = useRef(0);
  const introZoomStartRef = useRef<THREE.Vector3 | null>(null);
  const introZoomEndRef = useRef<THREE.Vector3 | null>(null);

  useEffect(() => {
    if (selectedServerIndex == null) {
      setShowServerDetailsExpanded(false);
    }
  }, [selectedServerIndex]);


  // Idea 5: Sync 3D selection to dashboard variable so other panels filter
  useEffect(() => {
    if (!(options.syncSelectionToVariable ?? false)) {
      return;
    }
    const varName = (options.syncSelectionVariableName || 'server_id').trim();
    if (!varName) {
      return;
    }
    let value: string;
    if (selectedServerIndex != null) {
      value = String(selectedServerIndex);
    } else if (selectedNodeRack != null) {
      value = String(selectedNodeRack * (options.serversPerRack ?? 8));
    } else {
      return;
    }
    locationService.partial({ ['var-' + varName]: value }, true);
  }, [
    options.syncSelectionToVariable,
    options.syncSelectionVariableName,
    options.serversPerRack,
    selectedServerIndex,
    selectedNodeRack,
  ]);

  // No auto-focus on load: panel always starts with central overview (same as Reset View).
  // User can click a server/rack to focus; sync-to-variable still works when they do.

  const dataMetrics = useMemo(() => parseGrafanaData(data, options.simulationMode ?? false), [data, options.simulationMode]);

  /** Server count: from data, or simulation length, or panel option when no data. */
  const effectiveServerCount = useMemo(() => {
    if (options.simulationMode) {
      return simulatedMetrics.length;
    }
    if (dataMetrics && dataMetrics.length > 0) {
      return dataMetrics.length;
    }
    return options.defaultServerCount ?? 64;
  }, [options.simulationMode, options.defaultServerCount, dataMetrics?.length, simulatedMetrics.length]);

  /** Layout derived from data + options; backend-agnostic. */
  const layout = useMemo(() => {
    const spr = options.serversPerRack ?? 8;
    const rpr = options.racksPerRow ?? 8;
    const numRacks = Math.max(1, Math.ceil(effectiveServerCount / spr));
    const rackRows = Math.max(1, Math.ceil(numRacks / rpr));
    const rackHeight = spr * (SERVER_HEIGHT + SERVER_SLOT_GAP) - SERVER_SLOT_GAP;
    const networkEdges = buildNetworkEdges(numRacks, rpr);
    return {
      serverCount: effectiveServerCount,
      numRacks,
      rackRows,
      racksPerRow: rpr,
      serversPerRack: spr,
      rackHeight,
      networkEdges,
    };
  }, [effectiveServerCount, options.serversPerRack, options.racksPerRow]);

  const effectiveMetrics = useMemo((): SimulatedMetric[] => {
    const count = layout.serverCount;
    if (options.simulationMode) {
      if (simulatedMetrics.length >= count) {
        return simulatedMetrics.slice(0, count);
      }
      return [
        ...simulatedMetrics,
        ...Array.from({ length: count - simulatedMetrics.length }, randomMetric),
      ];
    }
    if (dataMetrics?.length) {
      return Array.from({ length: count }, (_, i) =>
        dataMetrics[i] ?? { cpu: 0.4, temperature: 0.3, memory: 0.5, alert: false }
      );
    }
    return Array.from({ length: count }, () => ({
      cpu: 0.45,
      temperature: 0.35,
      memory: 0.5,
      alert: false,
    }));
  }, [options.simulationMode, simulatedMetrics, dataMetrics, layout.serverCount]);

  useEffect(() => {
    effectiveMetricsRef.current = effectiveMetrics;
  }, [effectiveMetrics]);
  useEffect(() => {
    hoveredServerIndexRef.current = hoveredServerIndex;
  }, [hoveredServerIndex]);
  useEffect(() => {
    selectedServerIndexRef.current = selectedServerIndex;
  }, [selectedServerIndex]);
  useEffect(() => {
    barColorHexRef.current =
      parseInt(getEffectiveBarColor(options.barColor).slice(1), 16) || 0x14b8a6;
  }, [options.barColor]);

  const cameraFlyTargetRef = useRef<THREE.Vector3 | null>(null);
  const cameraFlyLookAtRef = useRef<THREE.Vector3 | null>(null);
  const cameraFlyStartPosRef = useRef<THREE.Vector3 | null>(null);
  const cameraFlyStartTargetRef = useRef<THREE.Vector3 | null>(null);
  const cameraFlyProgressRef = useRef(0);
  const lastFrameTimeRef = useRef(0);
  const prevViewModeRef = useRef<string | undefined>(undefined);
  const anomalyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alertClearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alertServerIndexRef = useRef<number>(-1);
  const toggleSection = (id: string) => {
    setSectionsOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  };
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | THREE.OrthographicCamera | null>(null);
  const perspectiveCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orthographicCameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const serversRef = useRef<THREE.Mesh[]>([]);
  const rackGroupsRef = useRef<THREE.Group[]>([]);
  const networkLinesRef = useRef<THREE.Mesh[]>([]);
  const networkNodesRef = useRef<THREE.Mesh[]>([]);
  const rackPanelsRef = useRef<THREE.Mesh[]>([]);
  const linkTrafficRef = useRef<number[]>([]);
  const ambientLightRef = useRef<THREE.AmbientLight | null>(null);
  const directionalLightRef = useRef<THREE.DirectionalLight | null>(null);
  const hemisphereLightRef = useRef<THREE.HemisphereLight | null>(null);
  const rimLightRef = useRef<THREE.DirectionalLight | null>(null);
  const gridHelperRef = useRef<THREE.GridHelper | null>(null);
  const groundRef = useRef<THREE.Mesh | null>(null);
  const composerRef = useRef<InstanceType<typeof EffectComposer> | null>(null);
  const bloomPassRef = useRef<InstanceType<typeof UnrealBloomPass> | null>(null);
  const serverLerpRef = useRef<Array<{ scaleY: number; r: number; g: number; b: number; emissiveR: number; emissiveG: number; emissiveB: number; emissiveIntensity: number }>>([]);
  const effectiveMetricsRef = useRef<SimulatedMetric[]>([]);
  const hoveredServerIndexRef = useRef<number | null>(null);
  const selectedServerIndexRef = useRef<number | null>(null);
  const barColorHexRef = useRef<number>(0x14b8a6);
  const appearanceMapRef = useRef<THREE.Texture | null>(null);
  const raycasterRef = useRef<THREE.Raycaster | null>(null);
  const mouseRef = useRef<THREE.Vector2>(new THREE.Vector2());

  // Central overview: scene center; reset view = full distance; intro animates to slightly zoomed in.
  const sceneCenterY = layout.rackHeight / 2;
  const initialCenter = useMemo(() => new THREE.Vector3(0, sceneCenterY, 0), [sceneCenterY]);
  const initialCameraPosition = useMemo(() => {
    const dir = new THREE.Vector3(0, 6, 18).multiplyScalar(RESET_VIEW_DISTANCE_SCALE);
    return initialCenter.clone().add(dir);
  }, [initialCenter]);

  const updateOption = <K extends keyof SimpleOptions>(key: K, value: SimpleOptions[K]) => {
    onOptionsChange({ ...options, [key]: value });
  };

  // One-time: persist default texture "none" when option is missing or wrongly "glossy"
  const appliedTextureDefaultRef = useRef(false);
  useEffect(() => {
    if (appliedTextureDefaultRef.current) {
      return;
    }
    const current = options.textureStyle;
    if (current === undefined || current === null || current === 'glossy') {
      appliedTextureDefaultRef.current = true;
      onOptionsChange({ ...options, textureStyle: 'none' });
    }
  }, [options, onOptionsChange]);

  // Simulation mode: metric fluctuations + random anomaly (alert + camera fly)
  useEffect(() => {
    if (!(options.simulationMode ?? false)) {
      return;
    }
    const fluctuationId = setInterval(() => {
      setSimulatedMetrics((prev) =>
        prev.map((m) => ({
          ...m,
          cpu: clamp(m.cpu + rand(-0.06, 0.06)),
          temperature: clamp(m.temperature + rand(-0.04, 0.04)),
          memory: clamp(m.memory + rand(-0.04, 0.04)),
        }))
      );
    }, FLUCTUATION_INTERVAL_MS);

    const scheduleAnomaly = (): ReturnType<typeof setTimeout> => {
      const delay =
        ANOMALY_INTERVAL_MIN_MS +
        Math.random() * (ANOMALY_INTERVAL_MAX_MS - ANOMALY_INTERVAL_MIN_MS);
      return setTimeout(() => {
        const index = Math.floor(Math.random() * layout.serverCount);
        alertServerIndexRef.current = index;
        setSimulatedMetrics((prev) =>
          prev.map((m, i) => ({ ...m, alert: i === index }))
        );
        const servers = serversRef.current;
        if (servers[index]) {
          const worldPos = new THREE.Vector3();
          servers[index].getWorldPosition(worldPos);
          const cameraOffset = new THREE.Vector3(0, 1, 2.5);
          cameraFlyTargetRef.current = worldPos.clone().add(cameraOffset);
          cameraFlyLookAtRef.current = worldPos.clone();
          cameraFlyStartPosRef.current = cameraRef.current?.position.clone() ?? null;
          cameraFlyStartTargetRef.current = controlsRef.current?.target.clone() ?? null;
          cameraFlyProgressRef.current = 0;
        }
        if (alertClearTimeoutRef.current != null) {
          clearTimeout(alertClearTimeoutRef.current);
        }
        alertClearTimeoutRef.current = setTimeout(() => {
          alertServerIndexRef.current = -1;
          setSimulatedMetrics((prev) => prev.map((m) => ({ ...m, alert: false })));
          anomalyTimeoutRef.current = scheduleAnomaly();
        }, ANOMALY_ALERT_DURATION_MS);
      }, delay);
    };
    anomalyTimeoutRef.current = scheduleAnomaly();

    return () => {
      clearInterval(fluctuationId);
      if (anomalyTimeoutRef.current != null) {
        clearTimeout(anomalyTimeoutRef.current);
        anomalyTimeoutRef.current = null;
      }
      if (alertClearTimeoutRef.current != null) {
        clearTimeout(alertClearTimeoutRef.current);
        alertClearTimeoutRef.current = null;
      }
      cameraFlyTargetRef.current = null;
      cameraFlyLookAtRef.current = null;
      cameraFlyStartPosRef.current = null;
      cameraFlyStartTargetRef.current = null;
      alertServerIndexRef.current = -1;
    };
  }, [options.simulationMode, layout.serverCount]);

  // When in simulation mode, keep simulatedMetrics length in sync with defaultServerCount
  useEffect(() => {
    if (!(options.simulationMode ?? false)) {
      return;
    }
    const target = options.defaultServerCount ?? 64;
    setSimulatedMetrics((prev) => {
      if (prev.length === target) {
        return prev;
      }
      if (prev.length < target) {
        return [...prev, ...Array.from({ length: target - prev.length }, randomMetric)];
      }
      return prev.slice(0, target);
    });
  }, [options.simulationMode, options.defaultServerCount]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    // When layout changes we tear down and rebuild; cleanup sets rendererRef.current = null
    if (rendererRef.current) {
      return;
    }

    introZoomProgressRef.current = 0;
    introZoomStartRef.current = null;
    introZoomEndRef.current = null;

    const scene = new THREE.Scene();
    const bgHex = options.bgColor || '#1a1a24';
    scene.background = new THREE.Color(bgHex);
    scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);
    sceneRef.current = scene;

    const safeHeight = Math.max(height, 1);
    const aspect = width / safeHeight;

    const perspectiveCamera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
    const dir = new THREE.Vector3(0, 6, 18);
    const zoomStart = initialCenter.clone().add(dir.clone().multiplyScalar(RESET_VIEW_DISTANCE_SCALE));
    const zoomEnd = initialCenter.clone().add(dir.clone().multiplyScalar(INTRO_ZOOM_END_SCALE));
    perspectiveCamera.position.copy(zoomStart);
    introZoomDoneRef.current = false;
    introZoomStartRef.current = zoomStart;
    introZoomEndRef.current = zoomEnd;
    perspectiveCameraRef.current = perspectiveCamera;

    const orthoCamera = new THREE.OrthographicCamera(
      -ORTHO_2D_HALF * aspect,
      ORTHO_2D_HALF * aspect,
      ORTHO_2D_HALF,
      -ORTHO_2D_HALF,
      0.1,
      1000
    );
    orthoCamera.position.set(0, ORTHO_2D_Y, ORTHO_2D_Z);
    orthographicCameraRef.current = orthoCamera;

    const is2d = options.viewMode === '2d';
    const activeCamera = is2d ? orthoCamera : perspectiveCamera;
    cameraRef.current = activeCamera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, safeHeight);
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, activeCamera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, safeHeight),
      0.5,
      0.35,
      0.4
    );
    composer.addPass(bloomPass);
    composerRef.current = composer;
    bloomPassRef.current = bloomPass;

    const controls = new OrbitControls(activeCamera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = true;
    controls.minDistance = 1;
    controls.maxDistance = 100;
    controls.autoRotate = options.autorotate ?? false;
    if (is2d) {
      controls.target.set(0, 0, 0);
      controls.minPolarAngle = ORTHO_2D_POLAR;
      controls.maxPolarAngle = ORTHO_2D_POLAR;
    } else {
      controls.target.copy(initialCenter);
      controls.minPolarAngle = 0;
      controls.maxPolarAngle = Math.PI;
    }
    controlsRef.current = controls;

    const ambientLight = new THREE.AmbientLight(0xffffff, options.ambientIntensity ?? 0.6);
    scene.add(ambientLight);
    ambientLightRef.current = ambientLight;

    const directionalLight = new THREE.DirectionalLight(
      0xffffff,
      options.directionalIntensity ?? 0.9
    );
    directionalLight.position.set(
      options.dirLightX ?? 5,
      options.dirLightY ?? 10,
      options.dirLightZ ?? 5
    );
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 50;
    directionalLight.shadow.camera.left = -25;
    directionalLight.shadow.camera.right = 25;
    directionalLight.shadow.camera.top = 25;
    directionalLight.shadow.camera.bottom = -25;
    directionalLight.shadow.bias = -0.0001;
    scene.add(directionalLight);
    directionalLightRef.current = directionalLight;

    const fillIntensity = options.fillLightIntensity ?? 0.7;
    const hemisphereLight = new THREE.HemisphereLight(0x5a6a7e, 0x2a2c34, fillIntensity);
    scene.add(hemisphereLight);
    hemisphereLightRef.current = hemisphereLight;

    const rimLight = new THREE.DirectionalLight(0x6688aa, 0.25);
    rimLight.position.set(-6, 6, -8);
    scene.add(rimLight);
    rimLightRef.current = rimLight;

    if (options.showGrid ?? true) {
      const gridHelper = new THREE.GridHelper(GRID_SIZE, GRID_DIVISIONS, 0x2a2a38, 0x181822);
      scene.add(gridHelper);
      gridHelperRef.current = gridHelper;
    }

    const initialColorHex = getEffectiveBarColor(options.barColor);
    const initialColor = parseInt(initialColorHex.slice(1), 16) || 0x14b8a6;

    const localServers: THREE.Mesh[] = [];
    const localRacks: THREE.Group[] = [];
    const localRackPanels: THREE.Mesh[] = [];

    const serverCornerRadius = Math.min(
      SERVER_RADIUS,
      barSharpnessToRadius(options.barSharpness ?? DEFAULT_BAR_SHARPNESS) * 0.12
    );
    const serverGeometry = new RoundedBoxGeometry(
      SERVER_WIDTH,
      SERVER_HEIGHT,
      SERVER_DEPTH,
      SERVER_ROUND_SEGMENTS,
      Math.max(0.01, serverCornerRadius)
    );

    const { rackRows, racksPerRow, serversPerRack, rackHeight, serverCount, networkEdges } = layout;
    const centerX = ((racksPerRow - 1) * RACK_SPACING_X) / 2;
    const centerZ = ((rackRows - 1) * RACK_SPACING_Z) / 2;

    for (let row = 0; row < rackRows; row++) {
      for (let col = 0; col < racksPerRow; col++) {
        const rackIndex = row * racksPerRow + col;
        if (rackIndex >= layout.numRacks) {
          break;
        }
        const rackGroup = new THREE.Group();
        rackGroup.position.set(
          col * RACK_SPACING_X - centerX,
          0,
          row * RACK_SPACING_Z - centerZ
        );

        // Rack frame: thin back panel, bottom aligned with floor (y=0)
        const frameHeight = rackHeight + 0.04;
        const frameGeo = new THREE.BoxGeometry(RACK_WIDTH + 0.04, frameHeight, 0.04);
        const frameMat = new THREE.MeshStandardMaterial({
          color: RACK_FRAME_COLOR,
          metalness: 0.4,
          roughness: 0.55,
          envMapIntensity: 0.2,
        });
        const backPanel = new THREE.Mesh(frameGeo, frameMat);
        backPanel.position.set(0, frameHeight / 2, -RACK_DEPTH / 2 - 0.02);
        backPanel.castShadow = true;
        backPanel.receiveShadow = true;
        backPanel.userData = { type: 'rack', rackIndex };
        rackGroup.add(backPanel);
        localRackPanels.push(backPanel);

        for (let slot = 0; slot < serversPerRack; slot++) {
          const serverIndex = rackIndex * serversPerRack + slot;
          if (serverIndex >= serverCount) {
            break;
          }
          // Stack servers from floor up: bottom server center at SERVER_HEIGHT/2, no penetration
          const slotY =
            SERVER_HEIGHT / 2 +
            (serversPerRack - 1 - slot) * (SERVER_HEIGHT + SERVER_SLOT_GAP);
          const serverMat = new THREE.MeshStandardMaterial({
            color: initialColor,
            metalness: 0.15,
            roughness: 0.55,
            wireframe: options.wireframe ?? false,
          });
          const server = new THREE.Mesh(serverGeometry.clone(), serverMat);
          server.position.set(0, slotY, 0);
          server.castShadow = true;
          server.receiveShadow = true;
          server.userData = { rackRow: row, rackCol: col, slot, serverIndex };
          rackGroup.add(server);
          localServers.push(server);
        }

        scene.add(rackGroup);
        localRacks.push(rackGroup);
      }
    }

    serverGeometry.dispose();

    const networkY = rackHeight + NETWORK_ELEVATION_ABOVE_RACK;
    const getRackCenter = (r: number) =>
      new THREE.Vector3(
        (r % racksPerRow) * RACK_SPACING_X - centerX,
        networkY,
        Math.floor(r / racksPerRow) * RACK_SPACING_Z - centerZ
      );

    const networkLineMat = new THREE.MeshStandardMaterial({
      color: NETWORK_LINE_COLOR,
      emissive: NETWORK_LINE_COLOR,
      emissiveIntensity: 0.9,
      metalness: 0,
      roughness: 1,
      transparent: true,
      opacity: 0.9,
    });
    const localNetworkLines: THREE.Mesh[] = [];
    linkTrafficRef.current = networkEdges.map(() => 0.5);

    for (let ei = 0; ei < networkEdges.length; ei++) {
      const [a, b] = networkEdges[ei];
      const A = getRackCenter(a);
      const B = getRackCenter(b);
      const length = A.distanceTo(B);
      const cylGeo = new THREE.CylinderGeometry(
        NETWORK_LINE_RADIUS,
        NETWORK_LINE_RADIUS,
        length,
        8
      );
      cylGeo.rotateX(-Math.PI / 2);
      const lineMesh = new THREE.Mesh(cylGeo, networkLineMat.clone());
      lineMesh.position.copy(A).add(B).multiplyScalar(0.5);
      lineMesh.lookAt(B);
      lineMesh.userData = { type: 'link', edgeIndex: ei, rackA: a, rackB: b };
      scene.add(lineMesh);
      localNetworkLines.push(lineMesh);
    }

    networkLinesRef.current = localNetworkLines;

    const nodeGeo = new THREE.SphereGeometry(NODE_RADIUS, 12, 12);
    const nodeMat = new THREE.MeshStandardMaterial({
      color: NODE_COLOR,
      emissive: NODE_COLOR,
      emissiveIntensity: 0.6,
      metalness: 0,
      roughness: 1,
    });
    const localNodes: THREE.Mesh[] = [];
    for (let r = 0; r < layout.numRacks; r++) {
      const node = new THREE.Mesh(nodeGeo.clone(), nodeMat.clone());
      node.position.copy(getRackCenter(r));
      node.userData = { type: 'node', rackIndex: r };
      scene.add(node);
      localNodes.push(node);
    }
    nodeGeo.dispose();
    networkNodesRef.current = localNodes;

    const groundGeometry = new THREE.PlaneGeometry(GRID_SIZE * 2, GRID_SIZE * 2);
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x22222e,
      roughness: 0.95,
      metalness: 0.05,
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    scene.add(ground);
    groundRef.current = ground;
    serversRef.current = localServers;
    rackGroupsRef.current = localRacks;
    const { r, g, b } = new THREE.Color(initialColor);
    serverLerpRef.current = localServers.map(() => ({
      scaleY: 0.85,
      r,
      g,
      b,
      emissiveR: 0.04,
      emissiveG: 0.04,
      emissiveB: 0.04,
      emissiveIntensity: 0.2,
    }));
    rackPanelsRef.current = localRackPanels;

    const canvas = renderer.domElement;
    if (!raycasterRef.current) {
      raycasterRef.current = new THREE.Raycaster();
    }
    const raycaster = raycasterRef.current;
    const onMouseMove = (e: MouseEvent) => {
      const servers = serversRef.current;
      const lines = networkLinesRef.current;
      const nodes = networkNodesRef.current;
      const rackPanels = rackPanelsRef.current;
      const allInteractive = [...servers, ...lines, ...nodes, ...rackPanels];
      if (allInteractive.length === 0) {
        return;
      }
      const cam = cameraRef.current;
      if (!cam) {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouseRef.current, cam);
      const hits = raycaster.intersectObjects(allInteractive);
      const pos = { x: e.clientX, y: e.clientY };
      if (hits.length > 0) {
        const ud = hits[0].object.userData as {
          serverIndex?: number;
          type?: string;
          edgeIndex?: number;
          rackA?: number;
          rackB?: number;
          rackIndex?: number;
        };
        if (ud.serverIndex != null) {
          setHoveredServerIndex(ud.serverIndex);
          setHoveredLinkEdge(null);
          setHoveredNodeRack(null);
          setHoveredRackIndex(null);
          setTooltipPosition(pos);
          canvas.style.cursor = 'pointer';
          return;
        }
        if (ud.type === 'rack' && ud.rackIndex != null) {
          setHoveredServerIndex(null);
          setHoveredLinkEdge(null);
          setHoveredNodeRack(null);
          setHoveredRackIndex(ud.rackIndex);
          setTooltipPosition(pos);
          canvas.style.cursor = 'default';
          return;
        }
        if (ud.type === 'link' && ud.edgeIndex != null) {
          setHoveredServerIndex(null);
          setHoveredLinkEdge(ud.edgeIndex);
          setHoveredNodeRack(null);
          setHoveredRackIndex(null);
          setTooltipPosition(pos);
          canvas.style.cursor = 'default';
          return;
        }
        if (ud.type === 'node' && ud.rackIndex != null) {
          setHoveredServerIndex(null);
          setHoveredLinkEdge(null);
          setHoveredNodeRack(ud.rackIndex);
          setHoveredRackIndex(null);
          setTooltipPosition(pos);
          canvas.style.cursor = 'default';
          return;
        }
      }
      setHoveredServerIndex(null);
      setHoveredLinkEdge(null);
      setHoveredNodeRack(null);
      setHoveredRackIndex(null);
      setTooltipPosition(null);
      canvas.style.cursor = 'default';
    };
    const onMouseLeave = () => {
      setHoveredServerIndex(null);
      setHoveredLinkEdge(null);
      setHoveredNodeRack(null);
      setHoveredRackIndex(null);
      setTooltipPosition(null);
    };
    const onClick = (e: MouseEvent) => {
      const servers = serversRef.current;
      const lines = networkLinesRef.current;
      const nodes = networkNodesRef.current;
      const rackPanels = rackPanelsRef.current;
      const allInteractive = [...servers, ...lines, ...nodes, ...rackPanels];
      if (allInteractive.length === 0) {
        return;
      }
      const cam = cameraRef.current;
      if (!cam) {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouseRef.current, cam);
      const hits = raycaster.intersectObjects(allInteractive);
      const pos = { x: e.clientX, y: e.clientY };
      if (hits.length > 0) {
        const ud = hits[0].object.userData as {
          serverIndex?: number;
          type?: string;
          rackIndex?: number;
        };
        if (ud.serverIndex != null && serversRef.current[ud.serverIndex]) {
          setSelectedServerIndex(ud.serverIndex);
          setSelectedNodeRack(null);
          setSelectedTooltipPosition(pos);
          const worldPos = new THREE.Vector3();
          serversRef.current[ud.serverIndex].getWorldPosition(worldPos);
          const ctrl = controlsRef.current;
          if (cam === orthographicCameraRef.current && ctrl) {
            ctrl.target.copy(worldPos);
            ctrl.target.y = 0;
          } else if (ctrl) {
            const cameraOffset = new THREE.Vector3(0, 1, 2.5);
            cameraFlyTargetRef.current = worldPos.clone().add(cameraOffset);
            cameraFlyLookAtRef.current = worldPos.clone();
            cameraFlyStartPosRef.current = cam.position.clone();
            cameraFlyStartTargetRef.current = ctrl.target.clone();
            cameraFlyProgressRef.current = 0;
          }
          return;
        }
        if (ud.type === 'node' && ud.rackIndex != null) {
          setSelectedServerIndex(null);
          setSelectedNodeRack(ud.rackIndex);
          setSelectedTooltipPosition(pos);
          const node = networkNodesRef.current[ud.rackIndex];
          const ctrl = controlsRef.current;
          if (node && cam === orthographicCameraRef.current && ctrl) {
            const worldPos = new THREE.Vector3();
            node.getWorldPosition(worldPos);
            ctrl.target.copy(worldPos);
            ctrl.target.y = 0;
          } else if (node && ctrl) {
            const worldPos = new THREE.Vector3();
            node.getWorldPosition(worldPos);
            const cameraOffset = new THREE.Vector3(0, 1, 2.5);
            cameraFlyTargetRef.current = worldPos.clone().add(cameraOffset);
            cameraFlyLookAtRef.current = worldPos.clone();
            cameraFlyStartPosRef.current = cam.position.clone();
            cameraFlyStartTargetRef.current = ctrl.target.clone();
            cameraFlyProgressRef.current = 0;
          }
          return;
        }
        if (ud.type === 'rack' && ud.rackIndex != null) {
          const rackPanel = rackPanelsRef.current[ud.rackIndex];
          const ctrl = controlsRef.current;
          if (rackPanel && cam === orthographicCameraRef.current && ctrl) {
            const worldPos = new THREE.Vector3();
            rackPanel.getWorldPosition(worldPos);
            ctrl.target.copy(worldPos);
            ctrl.target.y = 0;
          } else if (rackPanel && ctrl) {
            const worldPos = new THREE.Vector3();
            rackPanel.getWorldPosition(worldPos);
            const cameraOffset = new THREE.Vector3(0, 1, 2.5);
            cameraFlyTargetRef.current = worldPos.clone().add(cameraOffset);
            cameraFlyLookAtRef.current = worldPos.clone();
            cameraFlyStartPosRef.current = cam.position.clone();
            cameraFlyStartTargetRef.current = ctrl.target.clone();
            cameraFlyProgressRef.current = 0;
          }
          return;
        }
      }
      setSelectedServerIndex(null);
      setSelectedNodeRack(null);
      setSelectedTooltipPosition(null);
      setAlertsListOpen(false);
    };
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('click', onClick);

    const HOVER_HIGHLIGHT_SCALE = 1.06;

    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!camera || !controls) {
        return;
      }
      const is2d = camera === orthographicCameraRef.current;
      const now = performance.now();
      const dt = lastFrameTimeRef.current ? (now - lastFrameTimeRef.current) / 1000 : 0;
      lastFrameTimeRef.current = now;

      const metrics = effectiveMetricsRef.current;
      const servers = serversRef.current;
      const lerpArr = serverLerpRef.current;
      const hovered = hoveredServerIndexRef.current;
      const selected = selectedServerIndexRef.current;
      const step = Math.min(1, LERP_SPEED * dt);

      if (lerpArr.length === servers.length && metrics.length >= servers.length) {
        for (let i = 0; i < servers.length; i++) {
          const server = servers[i];
          const mat = server.material;
          const metric = metrics[i];
          const targetScaleY = metric ? 0.5 + 0.7 * metric.cpu : 0.85;
          const defaultRgb = new THREE.Color(barColorHexRef.current);
          const targetColor = metric
            ? temperatureToColor(metric.temperature)
            : { r: defaultRgb.r, g: defaultRgb.g, b: defaultRgb.b };
          const isHighlighted = i === hovered || i === selected;
          const baseScale = isHighlighted ? HOVER_HIGHLIGHT_SCALE : 1;
          let targetEr = 0.04;
          let targetEg = 0.04;
          let targetEb = 0.04;
          let targetEi = metric ? metric.memory * 0.35 : 0.1;
          if (metric?.alert) {
            targetEr = 1;
            targetEg = 0.15;
            targetEb = 0.15;
            targetEi = 0.85 + 0.15 * Math.sin(now * 0.005);
          } else if (selected === i) {
            targetEr = 0.27;
            targetEg = 0.53;
            targetEb = 1;
            targetEi = 0.5;
          } else if (hovered === i) {
            targetEr = 0.2;
            targetEg = 0.4;
            targetEb = 0.8;
            targetEi = 0.2;
          }
          const cur = lerpArr[i];
          if (cur) {
            cur.scaleY += (targetScaleY - cur.scaleY) * step;
            cur.r += (targetColor.r - cur.r) * step;
            cur.g += (targetColor.g - cur.g) * step;
            cur.b += (targetColor.b - cur.b) * step;
            cur.emissiveR += (targetEr - cur.emissiveR) * step;
            cur.emissiveG += (targetEg - cur.emissiveG) * step;
            cur.emissiveB += (targetEb - cur.emissiveB) * step;
            cur.emissiveIntensity += (targetEi - cur.emissiveIntensity) * step;
            const idlePulse = metric?.alert
              ? 1.02 + 0.05 * Math.sin(now * 0.005)
              : 1 + 0.012 * Math.sin(now * 0.002 + i * 0.3);
            server.scale.set(
              baseScale * idlePulse,
              cur.scaleY * idlePulse,
              baseScale * idlePulse
            );
            if (mat instanceof THREE.MeshStandardMaterial) {
              mat.color.setRGB(cur.r, cur.g, cur.b);
              mat.emissive.setRGB(cur.emissiveR, cur.emissiveG, cur.emissiveB);
              mat.emissiveIntensity = cur.emissiveIntensity;
            }
          }
        }
      }

      const trafficArr = linkTrafficRef.current;
      networkLinesRef.current.forEach((line, i) => {
        const traffic = trafficArr[i] ?? 0.5;
        const pulse = 0.55 + 0.45 * Math.sin(now * 0.002);
        const thickness = (0.5 + 0.5 * traffic) * pulse;
        line.scale.set(thickness, 1, thickness);
      });
      networkNodesRef.current.forEach((node) => {
        const mat = node.material as THREE.MeshStandardMaterial;
        if (mat.emissiveIntensity != null) {
          mat.emissiveIntensity = 0.5 + 0.35 * Math.sin(now * 0.0025);
        }
      });

      if (!is2d) {
        if (
          cameraFlyTargetRef.current &&
          cameraFlyLookAtRef.current &&
          cameraFlyStartPosRef.current &&
          cameraFlyStartTargetRef.current
        ) {
          cameraFlyProgressRef.current += dt / (CAMERA_FLY_DURATION_MS / 1000);
          const t = Math.min(1, cameraFlyProgressRef.current);
          const smooth = t * t * (3 - 2 * t);
          camera.position.lerpVectors(
            cameraFlyStartPosRef.current,
            cameraFlyTargetRef.current,
            smooth
          );
          controls.target.lerpVectors(
            cameraFlyStartTargetRef.current,
            cameraFlyLookAtRef.current,
            smooth
          );
          if (cameraFlyProgressRef.current >= 1) {
            cameraFlyTargetRef.current = null;
            cameraFlyLookAtRef.current = null;
            cameraFlyStartPosRef.current = null;
            cameraFlyStartTargetRef.current = null;
            cameraFlyProgressRef.current = 0;
          }
        } else if (!introZoomDoneRef.current && introZoomStartRef.current && introZoomEndRef.current) {
          introZoomProgressRef.current += dt / INTRO_ZOOM_DURATION_S;
          const t = Math.min(1, introZoomProgressRef.current);
          const smooth = t * t * (3 - 2 * t);
          camera.position.lerpVectors(
            introZoomStartRef.current,
            introZoomEndRef.current,
            smooth
          );
          if (t >= 1) {
            introZoomDoneRef.current = true;
            introZoomStartRef.current = null;
            introZoomEndRef.current = null;
          }
        }
      }

      controls.update();
      if (composerRef.current) {
        composerRef.current.render();
      } else {
        renderer.render(scene, camera);
      }
    };
    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      canvas.removeEventListener('click', onClick);

      serversRef.current.forEach((s) => {
        s.geometry.dispose();
        const mat = s.material;
        if (Array.isArray(mat)) {
          mat.forEach((m) => m.dispose());
        } else {
          mat.dispose();
        }
      });
      serversRef.current = [];

      rackGroupsRef.current.forEach((group) => {
        group.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.geometry?.dispose();
            const m = obj.material;
            if (m) {
              (Array.isArray(m) ? m : [m]).forEach((mat) => mat.dispose());
            }
          }
        });
      });
      rackGroupsRef.current = [];

      networkLinesRef.current.forEach((line) => {
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      });
      networkLinesRef.current = [];
      networkNodesRef.current.forEach((node) => {
        node.geometry.dispose();
        (node.material as THREE.Material).dispose();
      });
      networkNodesRef.current = [];
      rackPanelsRef.current = [];

      if (controlsRef.current) {
        controlsRef.current.dispose();
        controlsRef.current = null;
      }

      if (composerRef.current) {
        composerRef.current.dispose();
        composerRef.current = null;
      }
      bloomPassRef.current = null;

      if (rendererRef.current) {
        const r = rendererRef.current;
        r.dispose();
        if (r.domElement?.parentNode) {
          r.domElement.parentNode.removeChild(r.domElement);
        }
        rendererRef.current = null;
      }

      if (sceneRef.current) {
        sceneRef.current.clear();
        sceneRef.current = null;
      }

      if (groundRef.current) {
        groundRef.current.geometry.dispose();
        (groundRef.current.material as THREE.Material).dispose();
        groundRef.current = null;
      }

      if (appearanceMapRef.current) {
        appearanceMapRef.current.dispose();
        appearanceMapRef.current = null;
      }

      cameraRef.current = null;
      perspectiveCameraRef.current = null;
      orthographicCameraRef.current = null;
      ambientLightRef.current = null;
      directionalLightRef.current = null;
      hemisphereLightRef.current = null;
      rimLightRef.current = null;
      gridHelperRef.current = null;
    };
    // Depend on layout structure (primitives) only so Refresh doesn't rebuild the scene and reset the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, layout.serverCount, layout.rackRows, layout.racksPerRow, layout.serversPerRack, layout.rackHeight]);

  useEffect(() => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const composer = composerRef.current;
    const bloomPass = bloomPassRef.current;
    const ortho = orthographicCameraRef.current;

    if (!renderer || !camera) {
      return;
    }

    const safeHeight = Math.max(height, 1);
    const aspect = width / safeHeight;
    renderer.setSize(width, safeHeight);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }
    if (ortho && options.viewMode === '2d') {
      ortho.left = -ORTHO_2D_HALF * aspect;
      ortho.right = ORTHO_2D_HALF * aspect;
      ortho.top = ORTHO_2D_HALF;
      ortho.bottom = -ORTHO_2D_HALF;
      ortho.updateProjectionMatrix();
    }
    if (composer) {
      composer.setSize(width, safeHeight);
      composer.setPixelRatio(renderer.getPixelRatio());
    }
    if (bloomPass) {
      bloomPass.resolution.set(width, safeHeight);
    }
  }, [width, height, options.viewMode]);

  useEffect(() => {
    const controls = controlsRef.current;
    const ortho = orthographicCameraRef.current;
    const persp = perspectiveCameraRef.current;
    const composer = composerRef.current;
    if (!controls || !ortho || !persp) {
      return;
    }
    const is2d = options.viewMode === '2d';
    if (is2d) {
      prevViewModeRef.current = '2d';
      cameraRef.current = ortho;
      controls.object = ortho;
      controls.target.set(0, 0, 0);
      ortho.position.set(0, ORTHO_2D_Y, ORTHO_2D_Z);
      controls.minPolarAngle = ORTHO_2D_POLAR;
      controls.maxPolarAngle = ORTHO_2D_POLAR;
      const aspect = width / Math.max(height, 1);
      ortho.left = -ORTHO_2D_HALF * aspect;
      ortho.right = ORTHO_2D_HALF * aspect;
      ortho.top = ORTHO_2D_HALF;
      ortho.bottom = -ORTHO_2D_HALF;
      ortho.near = 0.1;
      ortho.far = 1000;
      ortho.updateProjectionMatrix();
      if (composer?.passes?.[0]) {
        (composer.passes[0] as RenderPass).camera = ortho;
      }
    } else {
      cameraRef.current = persp;
      controls.object = persp;
      if (prevViewModeRef.current === '2d') {
        controls.target.copy(initialCenter);
        persp.position.copy(initialCameraPosition);
      }
      prevViewModeRef.current = '3d';
      controls.minPolarAngle = 0;
      controls.maxPolarAngle = Math.PI;
      if (composer?.passes?.[0]) {
        (composer.passes[0] as RenderPass).camera = persp;
      }
    }
  }, [options.viewMode, width, height, initialCenter, initialCameraPosition]);

  useEffect(() => {
    const scene = sceneRef.current;

    if (!scene) {
      return;
    }

    const bgHex = options.bgColor || '#1a1a24';
    scene.background = new THREE.Color(bgHex);
    if (scene.fog && scene.fog instanceof THREE.FogExp2) {
      scene.fog.color.set(bgHex);
    }

    if (ambientLightRef.current) {
      ambientLightRef.current.intensity = options.ambientIntensity ?? 0.6;
    }

    if (hemisphereLightRef.current) {
      hemisphereLightRef.current.intensity = options.fillLightIntensity ?? 0.7;
    }

    if (directionalLightRef.current) {
      directionalLightRef.current.intensity = options.directionalIntensity ?? 0.9;
      directionalLightRef.current.position.set(
        options.dirLightX ?? 5,
        options.dirLightY ?? 10,
        options.dirLightZ ?? 5
      );
    }

    if (options.showGrid ?? true) {
      if (!gridHelperRef.current) {
        const gridHelper = new THREE.GridHelper(GRID_SIZE, GRID_DIVISIONS);
        scene.add(gridHelper);
        gridHelperRef.current = gridHelper;
      }
    } else if (gridHelperRef.current) {
      scene.remove(gridHelperRef.current);
      gridHelperRef.current = null;
    }
  }, [
    options.bgColor,
    options.ambientIntensity,
    options.directionalIntensity,
    options.fillLightIntensity,
    options.dirLightX,
    options.dirLightY,
    options.dirLightZ,
    options.showGrid,
  ]);

  useEffect(() => {
    if (!controlsRef.current) {
      return;
    }
    controlsRef.current.autoRotate = options.autorotate ?? false;
  }, [options.autorotate]);

  useEffect(() => {
    serversRef.current.forEach((server) => {
      const mat = server.material;
      if (mat instanceof THREE.MeshStandardMaterial) {
        mat.wireframe = options.wireframe ?? false;
      }
    });
  }, [options.wireframe]);

  const HOVER_RACK_EMISSIVE = 0.22;
  const HOVER_LINE_EMISSIVE = 1.25;
  const HOVER_NODE_SCALE = 1.2;

  useEffect(() => {
    rackPanelsRef.current.forEach((mesh) => {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const rackIndex = (mesh.userData as { rackIndex?: number }).rackIndex;
      if (hoveredRackIndex === rackIndex) {
        mat.emissive.setHex(0x3366cc);
        mat.emissiveIntensity = HOVER_RACK_EMISSIVE;
      } else {
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
      }
    });
  }, [hoveredRackIndex]);

  useEffect(() => {
    networkLinesRef.current.forEach((line, i) => {
      const mat = line.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = hoveredLinkEdge === i ? HOVER_LINE_EMISSIVE : 0.9;
    });
  }, [hoveredLinkEdge]);

  const HOVER_NODE_EMISSIVE = 0.85;
  useEffect(() => {
    networkNodesRef.current.forEach((node, i) => {
      const hovered = hoveredNodeRack === i;
      const selected = selectedNodeRack === i;
      const highlighted = hovered || selected;
      const scale = highlighted ? HOVER_NODE_SCALE : 1;
      node.scale.setScalar(scale);
      const mat = node.material as THREE.MeshStandardMaterial;
      if (selected) {
        mat.emissive.setHex(0x4488ff);
        mat.emissiveIntensity = 0.5;
      } else if (hovered) {
        mat.emissive.setHex(0x3366cc);
        mat.emissiveIntensity = HOVER_NODE_EMISSIVE;
      } else {
        mat.emissive.setHex(NODE_COLOR);
        mat.emissiveIntensity = 0.6;
      }
    });
  }, [hoveredNodeRack, selectedNodeRack]);

  useEffect(() => {
    const servers = serversRef.current;
    if (servers.length === 0) {
      return;
    }

    const prevMap = appearanceMapRef.current;
    if (prevMap) {
      servers.forEach((s) => {
        const m = s.material as THREE.MeshStandardMaterial;
        if (m.map) {
          m.map = null;
        }
      });
      prevMap.dispose();
      appearanceMapRef.current = null;
    }

    const gradient = options.gradientEnabled ?? false;
    const style = getEffectiveTextureStyle(options.textureStyle);
    const barColorHex =
      parseInt(getEffectiveBarColor(options.barColor).slice(1), 16) || 0x14b8a6;

    const gradientBottom = options.gradientBottom ?? '#0d9488';
    const gradientTop = options.gradientTop ?? '#99f6e4';

    let map: THREE.Texture | null = null;
    if (gradient) {
      servers.forEach((server) => {
        applyGradientToGeometry(server.geometry, gradientBottom, gradientTop);
      });
      const oldTex = appearanceMapRef.current;
      if (oldTex) {
        oldTex.dispose();
        appearanceMapRef.current = null;
      }
    } else {
      if (PATTERN_STYLES.includes(style as PatternStyle)) {
        map = createPatternTexture(style as PatternStyle);
        appearanceMapRef.current = map;
      } else {
        const oldTex = appearanceMapRef.current;
        if (oldTex) {
          oldTex.dispose();
          appearanceMapRef.current = null;
        }
      }
    }

    const wireframe = options.wireframe ?? false;
    const isGlossy = style === 'glossy';
    const metalness = isGlossy ? 0.9 : 0.12;
    const roughness = isGlossy ? 0.06 : 0.6;

    servers.forEach((server) => {
      const oldMat = server.material as THREE.Material;
      if (gradient) {
        server.material = new THREE.MeshBasicMaterial({
          vertexColors: true,
          wireframe,
        });
        oldMat.dispose();
      } else {
        server.material = new THREE.MeshStandardMaterial({
          color: barColorHex,
          map: map ?? null,
          metalness,
          roughness,
          wireframe,
        });
        oldMat.dispose();
      }
    });
  }, [
    options.barColor,
    options.barSharpness,
    options.gradientEnabled,
    options.gradientTop,
    options.gradientBottom,
    options.textureStyle,
    options.wireframe,
  ]);

  // Update link traffic from metrics. Do not auto-fly camera to alerts on data refresh (only when user clicks Focus).
  useEffect(() => {
    const metrics = effectiveMetrics;
    const rackCpu: number[] = [];
    for (let r = 0; r < layout.numRacks; r++) {
      let sum = 0;
      for (let s = 0; s < layout.serversPerRack; s++) {
        const m = metrics[r * layout.serversPerRack + s];
        sum += m?.cpu ?? 0.5;
      }
      rackCpu[r] = sum / layout.serversPerRack;
    }
    const trafficArr: number[] = [];
    layout.networkEdges.forEach(([a, b], i) => {
      trafficArr[i] = ((rackCpu[a] ?? 0.5) + (rackCpu[b] ?? 0.5)) * 0.5;
    });
    linkTrafficRef.current = trafficArr;

    if (!(options.simulationMode ?? false)) {
      const alertIdx = metrics.findIndex((m) => m.alert);
      alertServerIndexRef.current = alertIdx >= 0 ? alertIdx : -1;
    }
  }, [options.simulationMode, effectiveMetrics, layout]);

  const resetView = () => {
    const cam = cameraRef.current;
    const controls = controlsRef.current;
    if (cam && controls) {
      if (cam === orthographicCameraRef.current) {
        cam.position.set(0, ORTHO_2D_Y, ORTHO_2D_Z);
        controls.target.set(0, 0, 0);
      } else {
        cam.position.copy(initialCameraPosition);
        controls.target.copy(initialCenter);
      }
      controls.update();
    }
    setMenuOpen(false);
  };

  const alertCount = effectiveMetrics.filter((m) => m.alert).length;
  const alertServerIndices = useMemo(
    () => effectiveMetrics.map((m, i) => (m.alert ? i : -1)).filter((i) => i >= 0),
    [effectiveMetrics]
  );
  const firstAlertIndex = effectiveMetrics.findIndex((m) => m.alert);
  const firstAlertRack = firstAlertIndex >= 0 ? Math.floor(firstAlertIndex / layout.serversPerRack) : -1;
  const firstAlertSlot = firstAlertIndex >= 0 ? firstAlertIndex % layout.serversPerRack : -1;

  const focusServer = (serverIndex: number) => {
    const servers = serversRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!servers[serverIndex] || !camera || !controls) {
      return;
    }
    const worldPos = new THREE.Vector3();
    servers[serverIndex].getWorldPosition(worldPos);
    if (camera === orthographicCameraRef.current) {
      controls.target.copy(worldPos);
      controls.target.y = 0;
    } else {
      const cameraOffset = new THREE.Vector3(0, 1, 2.5);
      cameraFlyTargetRef.current = worldPos.clone().add(cameraOffset);
      cameraFlyLookAtRef.current = worldPos.clone();
      cameraFlyStartPosRef.current = camera.position.clone();
      cameraFlyStartTargetRef.current = controls.target.clone();
      cameraFlyProgressRef.current = 0;
    }
    setSelectedServerIndex(serverIndex);
    setSelectedNodeRack(null);
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setSelectedTooltipPosition({
        x: rect.left + rect.width * 0.5,
        y: rect.top + rect.height * 0.35,
      });
    }
    setAlertsListOpen(false);
  };

  const openResourceDetailsUrl = (serverIndex: number) => {
    const raw = options.serverDetailsUrl?.trim();
    if (!raw) {
      return;
    }
    const serverId = effectiveMetricsRef.current[serverIndex]?.serverIdFromLabel ?? serverIndex;
    let path = raw
      .replace(/\$\{server_id\}/g, String(serverId))
      .replace(/\$\{server_rack\}/g, String(Math.floor(serverIndex / layout.serversPerRack)))
      .replace(/\$\{server_slot\}/g, String(serverIndex % layout.serversPerRack));
    path = replaceVariables(path, {
      server_id: { value: serverId, text: String(serverId) },
      server_rack: { value: Math.floor(serverIndex / layout.serversPerRack), text: String(Math.floor(serverIndex / layout.serversPerRack)) },
      server_slot: { value: serverIndex % layout.serversPerRack, text: String(serverIndex % layout.serversPerRack) },
    });
    const params = new URLSearchParams();
    params.set('var-server_id', String(serverId));
    const dsRef = data.request?.targets?.[0]?.datasource as { uid?: string } | undefined;
    if (dsRef?.uid) {
      params.set('var-datasource', dsRef.uid);
    }
    params.set('from', 'now-5m');
    params.set('to', 'now');
    params.set('refresh', '5s');
    const pathOnly = path.split('?')[0];
    const fullPath = pathOnly + '?' + params.toString();
    if (fullPath.startsWith('/')) {
      const loc = locationService.getLocation();
      const basePath = loc.pathname.split('/d/')[0] ?? '';
      const url = basePath + fullPath;
      locationService.push(url);
    } else {
      window.open(fullPath, '_blank', 'noopener,noreferrer');
    }
  };

  const openAlertsUrl = (serverId?: number) => {
    const url = options.alertsUrl?.trim();
    if (!url) {
      return;
    }
    let resolved = url;
    if (serverId != null) {
      const rack = Math.floor(serverId / layout.serversPerRack);
      const slot = serverId % layout.serversPerRack;
      resolved = resolved
        .replace(/\$\{server_id\}/g, String(serverId))
        .replace(/\$\{server_rack\}/g, String(rack))
        .replace(/\$\{server_slot\}/g, String(slot));
      resolved = replaceVariables(resolved, {
        server_id: { value: serverId, text: String(serverId) },
        server_rack: { value: rack, text: String(rack) },
        server_slot: { value: slot, text: String(slot) },
      });
    } else {
      resolved = replaceVariables(resolved);
      resolved = resolved
        .replace(/\$\{server_id\}/g, '')
        .replace(/\$\{server_rack\}/g, '')
        .replace(/\$\{server_slot\}/g, '');
    }
    if (resolved.startsWith('/')) {
      locationService.push(resolved);
    } else {
      window.open(resolved, '_blank', 'noopener,noreferrer');
    }
  };

  const handleAlertsClick = () => {
    const url = options.alertsUrl?.trim();
    if (url) {
      openAlertsUrl();
      return;
    }
    setAlertsListOpen((v) => !v);
  };

  const TOOLTIP_OFFSET = 6;
  const TOOLTIP_PADDING = 8;
  const TOOLTIP_WIDTH = 200;
  const TOOLTIP_HEIGHT = 160;

  const hasHoverTooltip =
    hoveredServerIndex != null ||
    hoveredLinkEdge != null ||
    hoveredNodeRack != null ||
    hoveredRackIndex != null;

  const getCoords = (
    pos: { x: number; y: number } | null,
    size: { w: number; h: number } = { w: TOOLTIP_WIDTH, h: TOOLTIP_HEIGHT }
  ) => {
    if (!pos || !containerRef.current) {
      return null;
    }
    const rect = containerRef.current.getBoundingClientRect();
    const relX = pos.x - rect.left;
    const relY = pos.y - rect.top;
    let left = relX + TOOLTIP_OFFSET;
    let top = relY + TOOLTIP_OFFSET;
    if (left + size.w + TOOLTIP_PADDING > rect.width) {
      left = relX - size.w - TOOLTIP_OFFSET;
    }
    if (top + size.h + TOOLTIP_PADDING > rect.height) {
      top = relY - size.h - TOOLTIP_OFFSET;
    }
    if (left < TOOLTIP_PADDING) {
      left = TOOLTIP_PADDING;
    }
    if (top < TOOLTIP_PADDING) {
      top = TOOLTIP_PADDING;
    }
    return { left, top };
  };

  const tooltipCoords = hasHoverTooltip && tooltipPosition ? getCoords(tooltipPosition) : null;
  const tooltipCoordsSmall =
    hasHoverTooltip && tooltipPosition
      ? getCoords(tooltipPosition, { w: 140, h: 52 })
      : null;
  const pinnedTooltipCoords =
    (selectedServerIndex != null || selectedNodeRack != null) && selectedTooltipPosition
      ? getCoords(selectedTooltipPosition)
      : null;

  return (
    <ClickOutsideWrapper onClick={() => setMenuOpen(false)}>
      <div className="g3d-viewport" style={{ width: '100%', height: '100%' }}>
        <div
          ref={containerRef}
          style={{
            position: 'absolute',
            inset: 0,
            background: options.bgColor || '#202020',
          }}
        />

        <div className="g3d-hud" aria-hidden>
          <div className="g3d-hud-title">Data Center Twin</div>
          <div className="g3d-hud-stats">
            <span>{layout.serverCount} servers</span>
            {alertCount > 0 ? (
              <button
                type="button"
                className="g3d-hud-alert g3d-hud-alert-btn"
                onClick={handleAlertsClick}
                title={options.alertsUrl?.trim() ? 'Open alerts in Grafana' : 'Show servers in alert'}
              >
                {alertCount} alert{alertCount !== 1 ? 's' : ''}
                {firstAlertRack >= 0 && (
                  <> — Rack {firstAlertRack}, Slot {firstAlertSlot}</>
                )}
              </button>
            ) : (
              <span className="g3d-hud-ok">All normal</span>
            )}
          </div>
          {alertsListOpen && alertCount > 0 && (
            <div className="g3d-alerts-list" role="list">
              <div className="g3d-alerts-list-title">
                Servers in alert ({alertCount})
              </div>
              {alertServerIndices.map((serverIndex) => {
                const rack = Math.floor(serverIndex / layout.serversPerRack);
                const slot = serverIndex % layout.serversPerRack;
                return (
                  <button
                    key={serverIndex}
                    type="button"
                    className="g3d-alerts-list-item"
                    onClick={() => focusServer(serverIndex)}
                    role="listitem"
                  >
                    Server {serverIndex} — Rack {rack}, Slot {slot}
                  </button>
                );
              })}
              <div className="g3d-alerts-list-hint">
                Click a server to focus. Set &quot;Alerts URL&quot; in panel settings (e.g. /alerting/list) to open Grafana Alerting.
              </div>
            </div>
          )}
        </div>

        {selectedServerIndex != null &&
          effectiveMetrics[selectedServerIndex] &&
          pinnedTooltipCoords && (() => {
            const serverIndex = selectedServerIndex;
            const m = effectiveMetrics[serverIndex];
            const serverId = m?.serverIdFromLabel ?? serverIndex;
            const rack = Math.floor(serverIndex / layout.serversPerRack);
            const slot = serverIndex % layout.serversPerRack;
            return (
              <div
                className={`g3d-tooltip g3d-tooltip-server g3d-tooltip-pinned ${showServerDetailsExpanded ? 'g3d-tooltip-expanded' : ''}`}
                style={{
                  position: 'absolute',
                  left: pinnedTooltipCoords.left,
                  top: pinnedTooltipCoords.top,
                  pointerEvents: 'auto',
                  zIndex: 1000,
                }}
              >
                <div className="g3d-tooltip-title">
                  Server {serverId} (Rack {rack}, Slot {slot})
                </div>
                <div className="g3d-tooltip-row">
                  CPU: {Math.round((m.cpu ?? 0) * 100)}%
                </div>
                <div className="g3d-tooltip-row">
                  Temp: {Math.round((m.temperature ?? 0) * 100)}%
                </div>
                <div className="g3d-tooltip-row">
                  Memory: {Math.round((m.memory ?? 0) * 100)}%
                </div>
                {m.alert && <div className="g3d-tooltip-alert">Alert</div>}
                <div className="g3d-tooltip-links">
                  {options.serverDetailsUrl?.trim() && (
                    <a
                      className="g3d-tooltip-link"
                      href="#resource"
                      onClick={(ev) => {
                        ev.preventDefault();
                        openResourceDetailsUrl(serverIndex);
                      }}
                    >
                      View resource
                    </a>
                  )}
                  {m.alert && (
                    <a
                      className="g3d-tooltip-link"
                      href={options.alertsUrl?.trim() || '#'}
                      onClick={(ev) => {
                        ev.preventDefault();
                        if (options.alertsUrl?.trim()) {
                          openAlertsUrl(serverId);
                        } else {
                          setAlertsListOpen(true);
                        }
                      }}
                    >
                      View alerts
                    </a>
                  )}
                  {(options.showContextPanel ?? false) &&
                    (() => {
                      const tpl = options.runbookUrlTemplate?.trim();
                      if (!tpl) {
                        return (
                          <span className="g3d-tooltip-muted" title="Optional: set Runbook URL template in panel options (e.g. https://wiki.example.com/runbook?id=${server_id})">
                            Runbook — set URL in panel options
                          </span>
                        );
                      }
                      let runbookUrl = tpl
                        .replace(/\$\{server_id\}/g, String(serverId))
                        .replace(/\$\{server_rack\}/g, String(rack))
                        .replace(/\$\{server_slot\}/g, String(slot));
                      runbookUrl = replaceVariables(runbookUrl, {
                        server_id: { value: serverId, text: String(serverId) },
                        server_rack: { value: rack, text: String(rack) },
                        server_slot: { value: slot, text: String(slot) },
                      });
                      const isValidRunbookUrl =
                        runbookUrl.startsWith('http://') ||
                        runbookUrl.startsWith('https://') ||
                        runbookUrl.startsWith('/');
                      if (isValidRunbookUrl) {
                        return (
                          <a
                            className="g3d-tooltip-link"
                            href={runbookUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Runbook
                          </a>
                        );
                      }
                      return (
                        <span
                          className="g3d-tooltip-muted"
                          title="Runbook URL must be a full URL (https://...) or a path starting with / (e.g. /d/dashboard?var-server_id=${server_id}). Update in panel options."
                        >
                          Runbook — fix URL in panel options
                        </span>
                      );
                    })()}
                </div>
                {showServerDetailsExpanded && (
                  <div className="g3d-tooltip-details">
                    <div className="g3d-tooltip-details-title">Details</div>
                    <div className="g3d-tooltip-row">Server ID: {serverId}</div>
                    <div className="g3d-tooltip-row">Rack: {rack}, Slot: {slot}</div>
                    <div className="g3d-tooltip-row">
                      Status: {m.alert ? 'Alert' : 'Normal'}
                    </div>
                    <div className="g3d-tooltip-hint">
                      To open a dashboard for this server, set &quot;Server details URL&quot; in panel
                      settings and use $&#123;server_id&#125;, $&#123;server_rack&#125;, $&#123;server_slot&#125;.
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

        {selectedServerIndex == null &&
          hoveredServerIndex != null &&
          effectiveMetrics[hoveredServerIndex] &&
          tooltipCoords && (() => {
            const serverIndex = hoveredServerIndex;
            const serverId = effectiveMetrics[serverIndex]?.serverIdFromLabel ?? serverIndex;
            const rack = Math.floor(serverIndex / layout.serversPerRack);
            const slot = serverIndex % layout.serversPerRack;
            return (
            <div
              className="g3d-tooltip g3d-tooltip-server"
              style={{
                position: 'absolute',
                left: tooltipCoords.left,
                top: tooltipCoords.top,
                pointerEvents: 'none',
                zIndex: 1000,
              }}
            >
              <div className="g3d-tooltip-title">
                Server {serverId} (Rack {rack}, Slot {slot})
              </div>
              <div className="g3d-tooltip-row">Server ID: {serverId}</div>
              <div className="g3d-tooltip-row">
                CPU: {Math.round((effectiveMetrics[hoveredServerIndex].cpu ?? 0) * 100)}%
              </div>
              <div className="g3d-tooltip-row">
                Temp: {Math.round((effectiveMetrics[hoveredServerIndex].temperature ?? 0) * 100)}%
              </div>
              <div className="g3d-tooltip-row">
                Memory: {Math.round((effectiveMetrics[hoveredServerIndex].memory ?? 0) * 100)}%
              </div>
              {effectiveMetrics[hoveredServerIndex].alert && (
                <div className="g3d-tooltip-alert">Alert</div>
              )}
              <div className="g3d-tooltip-hint">Click to focus and pin tooltip</div>
            </div>
            );
          })()}

        {hoveredLinkEdge != null && tooltipCoordsSmall && (
          <div
            className="g3d-tooltip g3d-tooltip-link"
            style={{
              position: 'absolute',
              left: tooltipCoordsSmall.left,
              top: tooltipCoordsSmall.top,
              pointerEvents: 'none',
              zIndex: 1000,
            }}
          >
            <div className="g3d-tooltip-title">
              Rack {layout.networkEdges[hoveredLinkEdge][0]} ↔ Rack {layout.networkEdges[hoveredLinkEdge][1]}
            </div>
            <div className="g3d-tooltip-row">Network link</div>
          </div>
        )}

        {selectedNodeRack != null && pinnedTooltipCoords && (
          <div
            className="g3d-tooltip g3d-tooltip-node g3d-tooltip-pinned"
            style={{
              position: 'absolute',
              left: pinnedTooltipCoords.left,
              top: pinnedTooltipCoords.top,
              pointerEvents: 'auto',
              zIndex: 1000,
            }}
          >
            <div className="g3d-tooltip-title">Rack {selectedNodeRack}</div>
            <div className="g3d-tooltip-row">Network node</div>
            <div className="g3d-tooltip-links">
              {options.serverDetailsUrl?.trim() && (
                <a
                  className="g3d-tooltip-link"
                  href="#resource"
                  onClick={(ev) => {
                    ev.preventDefault();
                    openResourceDetailsUrl(selectedNodeRack * layout.serversPerRack);
                  }}
                >
                  View resource
                </a>
              )}
              {(() => {
                const firstServerId = selectedNodeRack * layout.serversPerRack;
                const rackHasAlert = effectiveMetrics
                  .slice(firstServerId, firstServerId + layout.serversPerRack)
                  .some((metric) => metric.alert);
                if (!rackHasAlert) {
                  return null;
                }
                return (
                  <a
                    className="g3d-tooltip-link"
                    href={options.alertsUrl?.trim() || '#'}
                    onClick={(ev) => {
                      ev.preventDefault();
                      if (options.alertsUrl?.trim()) {
                        openAlertsUrl(firstServerId);
                      } else {
                        setAlertsListOpen(true);
                      }
                    }}
                  >
                    View alerts
                  </a>
                );
              })()}
              {(options.showContextPanel ?? false) &&
                (() => {
                  const serverId = selectedNodeRack * layout.serversPerRack;
                  const rack = selectedNodeRack;
                  const slot = 0;
                  const tpl = options.runbookUrlTemplate?.trim();
                  if (!tpl) {
                    return (
                      <span className="g3d-tooltip-muted" title="Optional: set Runbook URL template in panel options.">
                        Runbook — set URL in panel options
                      </span>
                    );
                  }
                  let runbookUrl = tpl
                    .replace(/\$\{server_id\}/g, String(serverId))
                    .replace(/\$\{server_rack\}/g, String(rack))
                    .replace(/\$\{server_slot\}/g, String(slot));
                  runbookUrl = replaceVariables(runbookUrl, {
                    server_id: { value: serverId, text: String(serverId) },
                    server_rack: { value: rack, text: String(rack) },
                    server_slot: { value: slot, text: String(slot) },
                  });
                  const isValidRunbookUrl =
                    runbookUrl.startsWith('http://') ||
                    runbookUrl.startsWith('https://') ||
                    runbookUrl.startsWith('/');
                  if (isValidRunbookUrl) {
                    return (
                      <a
                        className="g3d-tooltip-link"
                        href={runbookUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Runbook
                      </a>
                    );
                  }
                  return (
                    <span
                      className="g3d-tooltip-muted"
                      title="Runbook URL must be a full URL (https://...) or path starting with /."
                    >
                      Runbook — fix URL in panel options
                    </span>
                  );
                })()}
            </div>
          </div>
        )}

        {selectedNodeRack == null && hoveredNodeRack != null && tooltipCoordsSmall && (
          <div
            className="g3d-tooltip g3d-tooltip-node"
            style={{
              position: 'absolute',
              left: tooltipCoordsSmall.left,
              top: tooltipCoordsSmall.top,
              pointerEvents: 'none',
              zIndex: 1000,
            }}
          >
            <div className="g3d-tooltip-title">Rack {hoveredNodeRack}</div>
            <div className="g3d-tooltip-row">Network node</div>
          </div>
        )}

        {hoveredRackIndex != null && tooltipCoords && (() => {
          const start = hoveredRackIndex * layout.serversPerRack;
          const rackMetrics = effectiveMetrics.slice(start, start + layout.serversPerRack);
          const avgCpu = rackMetrics.length
            ? rackMetrics.reduce((a, m) => a + (m?.cpu ?? 0), 0) / rackMetrics.length
            : 0;
          const maxTemp = rackMetrics.length
            ? Math.max(...rackMetrics.map((m) => m?.temperature ?? 0))
            : 0;
          const alertInRack = rackMetrics.filter((m) => m?.alert).length;
          return (
            <div
              className="g3d-tooltip g3d-tooltip-rack"
              style={{
                position: 'absolute',
                left: tooltipCoords.left,
                top: tooltipCoords.top,
                pointerEvents: 'none',
                zIndex: 1000,
              }}
            >
              <div className="g3d-tooltip-title">Rack {hoveredRackIndex}</div>
              <div className="g3d-tooltip-row">
                Avg CPU: {Math.round(avgCpu * 100)}%
              </div>
              <div className="g3d-tooltip-row">
                Max temp: {Math.round(maxTemp * 100)}%
              </div>
              <div className="g3d-tooltip-row">
                Servers: {layout.serversPerRack}
              </div>
              {alertInRack > 0 && (
                <div className="g3d-tooltip-alert">{alertInRack} alert(s)</div>
              )}
            </div>
          );
        })()}

        {menuOpen && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 5,
              cursor: 'default',
            }}
            onClick={() => setMenuOpen(false)}
          />
        )}

        <IconButton
          className="g3d-settings-btn"
          name="cog"
          tooltip="Settings"
          onClick={() => setMenuOpen((o) => !o)}
          size="md"
        />

        {menuOpen && (
          <div className="g3d-floating-menu">
            <div className="g3d-menu-section">
              <button
                type="button"
                className="g3d-menu-section-header"
                onClick={() => toggleSection('lighting')}
                aria-expanded={sectionsOpen['lighting'] ?? true}
              >
                <span className="g3d-menu-section-chevron" aria-hidden>▼</span>
                <span className="g3d-menu-section-title">Lighting</span>
              </button>
              <div
                className={`g3d-menu-section-body ${sectionsOpen['lighting'] ?? true ? '' : 'collapsed'}`}
              >
              <div className="g3d-menu-row">
                <span className="g3d-menu-label">Ambient</span>
                <input
                  type="range"
                  className="g3d-menu-slider"
                  min={0}
                  max={3}
                  step={0.05}
                  value={options.ambientIntensity ?? 0.6}
                  onChange={(e) => updateOption('ambientIntensity', parseFloat(e.target.value))}
                />
              </div>
              <div className="g3d-menu-row">
                <span className="g3d-menu-label">Directional</span>
                <input
                  type="range"
                  className="g3d-menu-slider"
                  min={0}
                  max={3}
                  step={0.05}
                  value={options.directionalIntensity ?? 0.9}
                  onChange={(e) => updateOption('directionalIntensity', parseFloat(e.target.value))}
                />
              </div>
              <div className="g3d-menu-row">
                <span className="g3d-menu-label">Fill / environment</span>
                <input
                  type="range"
                  className="g3d-menu-slider"
                  min={0}
                  max={2}
                  step={0.05}
                  value={options.fillLightIntensity ?? 0.7}
                  onChange={(e) => updateOption('fillLightIntensity', parseFloat(e.target.value))}
                />
              </div>
              <div className="g3d-menu-row">
                <span className="g3d-menu-label">Direction X</span>
                <input
                  type="range"
                  className="g3d-menu-slider"
                  min={-20}
                  max={20}
                  step={0.5}
                  value={options.dirLightX ?? 5}
                  onChange={(e) => updateOption('dirLightX', parseFloat(e.target.value))}
                />
              </div>
              <div className="g3d-menu-row">
                <span className="g3d-menu-label">Direction Y</span>
                <input
                  type="range"
                  className="g3d-menu-slider"
                  min={-20}
                  max={20}
                  step={0.5}
                  value={options.dirLightY ?? 10}
                  onChange={(e) => updateOption('dirLightY', parseFloat(e.target.value))}
                />
              </div>
              <div className="g3d-menu-row">
                <span className="g3d-menu-label">Direction Z</span>
                <input
                  type="range"
                  className="g3d-menu-slider"
                  min={-20}
                  max={20}
                  step={0.5}
                  value={options.dirLightZ ?? 5}
                  onChange={(e) => updateOption('dirLightZ', parseFloat(e.target.value))}
                />
              </div>
              </div>
            </div>

            <div className="g3d-menu-section">
              <button
                type="button"
                className="g3d-menu-section-header"
                onClick={() => toggleSection('appearance')}
                aria-expanded={sectionsOpen['appearance'] ?? true}
              >
                <span className="g3d-menu-section-chevron" aria-hidden>▼</span>
                <span className="g3d-menu-section-title">Appearance</span>
              </button>
              <div
                className={`g3d-menu-section-body ${sectionsOpen['appearance'] ?? true ? '' : 'collapsed'}`}
              >
              <div className="g3d-menu-row">
                <span className="g3d-menu-label">Bar color</span>
                <input
                  type="color"
                  className="g3d-menu-color"
                  value={effectiveBarColor}
                  onChange={(e) => updateOption('barColor', e.target.value)}
                />
              </div>
              <div className="g3d-menu-row">
                <span className="g3d-menu-label">Sharpness</span>
                <input
                  type="range"
                  className="g3d-menu-slider"
                  min={0}
                  max={100}
                  step={2}
                  value={((options.barSharpness ?? DEFAULT_BAR_SHARPNESS) * 100)}
                  onChange={(e) =>
                    updateOption('barSharpness', parseInt(e.target.value, 10) / 100)
                  }
                />
              </div>
              <div className="g3d-menu-row">
                <span className="g3d-menu-label">Gradient</span>
                <div
                  className={`g3d-menu-toggle ${options.gradientEnabled ?? false ? 'on' : ''}`}
                  onClick={() => updateOption('gradientEnabled', !(options.gradientEnabled ?? false))}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) =>
                    e.key === 'Enter' && updateOption('gradientEnabled', !(options.gradientEnabled ?? false))
                  }
                />
              </div>
              {(options.gradientEnabled ?? false) && (
                <>
                  <div className="g3d-menu-row">
                    <span className="g3d-menu-label">Gradient top</span>
                    <input
                      type="color"
                      className="g3d-menu-color"
                      value={options.gradientTop ?? '#99f6e4'}
                      onChange={(e) => updateOption('gradientTop', e.target.value)}
                    />
                  </div>
                  <div className="g3d-menu-row">
                    <span className="g3d-menu-label">Gradient bottom</span>
                    <input
                      type="color"
                      className="g3d-menu-color"
                      value={options.gradientBottom ?? '#0d9488'}
                      onChange={(e) => updateOption('gradientBottom', e.target.value)}
                    />
                  </div>
                </>
              )}
              <div className="g3d-menu-row">
                <span className="g3d-menu-label">Texture</span>
                <select
                  className="g3d-menu-select"
                  value={getEffectiveTextureStyle(options.textureStyle)}
                  onChange={(e) =>
                    updateOption('textureStyle', e.target.value as SimpleOptions['textureStyle'])
                  }
                >
                  <option value="none">None</option>
                  <option value="checker">Checker</option>
                  <option value="dots">Dots</option>
                  <option value="stripes">Stripes</option>
                  <option value="glossy">Glossy (glass / metal)</option>
                </select>
              </div>
              </div>
            </div>

            <div className="g3d-menu-section">
              <button
                type="button"
                className="g3d-menu-section-header"
                onClick={() => toggleSection('scene')}
                aria-expanded={sectionsOpen['scene'] ?? true}
              >
                <span className="g3d-menu-section-chevron" aria-hidden>▼</span>
                <span className="g3d-menu-section-title">Scene</span>
              </button>
              <div
                className={`g3d-menu-section-body ${sectionsOpen['scene'] ?? true ? '' : 'collapsed'}`}
              >
              <div className="g3d-menu-row">
                <span className="g3d-menu-label">Background</span>
                <input
                  type="color"
                  className="g3d-menu-color"
                  value={options.bgColor || '#202020'}
                  onChange={(e) => updateOption('bgColor', e.target.value)}
                />
              </div>
              <div className="g3d-menu-row">
                <span className="g3d-menu-label">Grid</span>
                <div
                  className={`g3d-menu-toggle ${options.showGrid ?? true ? 'on' : ''}`}
                  onClick={() => updateOption('showGrid', !(options.showGrid ?? true))}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && updateOption('showGrid', !(options.showGrid ?? true))}
                />
              </div>
              <div className="g3d-menu-row">
                <span className="g3d-menu-label">Wireframe</span>
                <div
                  className={`g3d-menu-toggle ${options.wireframe ?? false ? 'on' : ''}`}
                  onClick={() => updateOption('wireframe', !(options.wireframe ?? false))}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && updateOption('wireframe', !(options.wireframe ?? false))}
                />
              </div>
              <div className="g3d-menu-row">
                <span className="g3d-menu-label">Skeleton</span>
                <div
                  className={`g3d-menu-toggle ${options.skeleton ?? false ? 'on' : ''}`}
                  onClick={() => updateOption('skeleton', !(options.skeleton ?? false))}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && updateOption('skeleton', !(options.skeleton ?? false))}
                />
              </div>
              </div>
            </div>

            <div className="g3d-menu-section">
              <button
                type="button"
                className="g3d-menu-section-header"
                onClick={() => toggleSection('layout')}
                aria-expanded={sectionsOpen['layout'] ?? true}
              >
                <span className="g3d-menu-section-chevron" aria-hidden>▼</span>
                <span className="g3d-menu-section-title">Layout</span>
              </button>
              <div
                className={`g3d-menu-section-body ${sectionsOpen['layout'] ?? true ? '' : 'collapsed'}`}
              >
              <div className="g3d-menu-row">
                <span className="g3d-menu-label">Racks per row</span>
                <input
                  type="range"
                  className="g3d-menu-slider"
                  min={1}
                  max={16}
                  step={1}
                  value={options.racksPerRow ?? 8}
                  onChange={(e) => updateOption('racksPerRow', parseInt(e.target.value, 10))}
                />
                <span className="g3d-menu-value">{options.racksPerRow ?? 8}</span>
              </div>
              <div className="g3d-menu-row">
                <span className="g3d-menu-label">Servers per rack</span>
                <input
                  type="range"
                  className="g3d-menu-slider"
                  min={1}
                  max={48}
                  step={1}
                  value={options.serversPerRack ?? 8}
                  onChange={(e) => updateOption('serversPerRack', parseInt(e.target.value, 10))}
                />
                <span className="g3d-menu-value">{options.serversPerRack ?? 8}</span>
              </div>
              <div className="g3d-menu-row">
                <span className="g3d-menu-label">Default server count (no data)</span>
                <input
                  type="range"
                  className="g3d-menu-slider"
                  min={1}
                  max={200}
                  step={1}
                  value={options.defaultServerCount ?? 64}
                  onChange={(e) => updateOption('defaultServerCount', parseInt(e.target.value, 10))}
                />
                <span className="g3d-menu-value">{options.defaultServerCount ?? 64}</span>
              </div>
              </div>
            </div>

            <div className="g3d-menu-section">
              <button
                type="button"
                className="g3d-menu-section-header"
                onClick={() => toggleSection('camera')}
                aria-expanded={sectionsOpen['camera'] ?? true}
              >
                <span className="g3d-menu-section-chevron" aria-hidden>▼</span>
                <span className="g3d-menu-section-title">Camera</span>
              </button>
              <div
                className={`g3d-menu-section-body ${sectionsOpen['camera'] ?? true ? '' : 'collapsed'}`}
              >
              <div className="g3d-menu-row">
                <span className="g3d-menu-label">2D (top-down)</span>
                <div
                  className={`g3d-menu-toggle ${options.viewMode === '2d' ? 'on' : ''}`}
                  onClick={() => updateOption('viewMode', options.viewMode === '2d' ? '3d' : '2d')}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) =>
                    e.key === 'Enter' && updateOption('viewMode', options.viewMode === '2d' ? '3d' : '2d')
                  }
                />
              </div>
              <div className="g3d-menu-row">
                <span className="g3d-menu-label">Auto-Rotate</span>
                <div
                  className={`g3d-menu-toggle ${options.autorotate ?? false ? 'on' : ''}`}
                  onClick={() => updateOption('autorotate', !(options.autorotate ?? false))}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && updateOption('autorotate', !(options.autorotate ?? false))}
                />
              </div>
              <button type="button" className="g3d-menu-btn" onClick={resetView}>
                Reset View
              </button>
              </div>
            </div>

            <div className="g3d-menu-section">
              <button
                type="button"
                className="g3d-menu-section-header"
                onClick={() => toggleSection('simulation')}
                aria-expanded={sectionsOpen['simulation'] ?? true}
              >
                <span className="g3d-menu-section-chevron" aria-hidden>▼</span>
                <span className="g3d-menu-section-title">Simulation Mode</span>
              </button>
              <div
                className={`g3d-menu-section-body ${sectionsOpen['simulation'] ?? true ? '' : 'collapsed'}`}
              >
              <div className="g3d-menu-row">
                <span className="g3d-menu-label">Simulation Mode</span>
                <div
                  className={`g3d-menu-toggle ${options.simulationMode ?? false ? 'on' : ''}`}
                  onClick={() => updateOption('simulationMode', !(options.simulationMode ?? false))}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) =>
                    e.key === 'Enter' &&
                    updateOption('simulationMode', !(options.simulationMode ?? false))
                  }
                />
              </div>
              <div className="g3d-menu-row">
                <span className="g3d-menu-label" style={{ fontSize: 9, opacity: 0.8 }}>
                  Fake metrics; anomaly every 15–30s
                </span>
              </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </ClickOutsideWrapper>
  );
};

export default SimplePanel;
