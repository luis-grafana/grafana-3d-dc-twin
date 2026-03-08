type SeriesSize = 'sm' | 'md' | 'lg';

export interface SimpleOptions {
  text: string;
  showSeriesCount: boolean;
  seriesCountSize: SeriesSize;

  // Background color of the panel
  bgColor?: string;

  // Whether the panel should autorotate
  autorotate?: boolean;

  // Whether the mesh is wireframe
  wireframe?: boolean;

  // Show a grid helper
  showGrid?: boolean;
  skeleton?: boolean;

  /** '3d' = perspective + orbit; '2d' = orthographic top-down, same scene and effects. */
  viewMode?: '2d' | '3d';

  // Lighting options
  ambientIntensity?: number;
  directionalIntensity?: number;
  /** Fill / environment light (hemisphere); lifts overall scene brightness. */
  fillLightIntensity?: number;
  dirLightX?: number;
  dirLightY?: number;
  dirLightZ?: number;

  // Bar appearance
  barColor?: string;
  /** 0 = very rounded, 1 = sharp edges. Default 0.76 (radius 0.12) */
  barSharpness?: number;
  gradientEnabled?: boolean;
  gradientTop?: string;
  gradientBottom?: string;
  textureStyle?: 'none' | 'checker' | 'dots' | 'stripes' | 'glossy';

  /** When true, fake metric fluctuations and random anomaly (alert + camera fly) for demo. */
  simulationMode?: boolean;

  /** Optional URL for "Server details" link. Use ${server_id}, ${server_rack}, ${server_slot}. */
  serverDetailsUrl?: string;

  /** Optional URL when clicking "X alerts" in the HUD (e.g. /alerting/list for Grafana Alerting). */
  alertsUrl?: string;

  /** When true, selecting a server/rack in 3D updates the dashboard variable so other panels filter. */
  syncSelectionToVariable?: boolean;
  /** Dashboard variable name to update on selection (e.g. server_id). Used for sync and for initial focus. */
  syncSelectionVariableName?: string;
  /** When true, show a context panel (links to Explore, Runbook) when a server/rack is selected. */
  showContextPanel?: boolean;
  /** Optional runbook URL template. Use ${server_id}, ${server_rack}, ${server_slot}. */
  runbookUrlTemplate?: string;

  /** Layout: racks per row (columns). Used with any backend; scene adapts to data. */
  racksPerRow?: number;
  /** Layout: servers per rack (stack height). */
  serversPerRack?: number;
  /** When no data (or simulation): how many server slots to show. */
  defaultServerCount?: number;
}
