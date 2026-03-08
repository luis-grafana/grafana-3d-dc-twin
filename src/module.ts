import { PanelPlugin } from '@grafana/data';
import { SimpleOptions } from './types';
import SimplePanel from './components/SimplePanel';

export const plugin = new PanelPlugin<SimpleOptions>(SimplePanel)
  .setDefaults({
    textureStyle: 'none',
    serverDetailsUrl: '',
    viewMode: '3d',
    racksPerRow: 8,
    serversPerRack: 8,
    defaultServerCount: 64,
  } as SimpleOptions)
  .setMigrationHandler((panel) => {
    const opts = panel.options || {};
    let serverDetailsUrl = opts.serverDetailsUrl as string | undefined;
    // Only apply default when never set or placeholder; do not overwrite when user cleared the field
    if (serverDetailsUrl === undefined || (typeof serverDetailsUrl === 'string' && serverDetailsUrl.includes('your-dashboard-uid'))) {
      serverDetailsUrl = '/d/dc-server-details?var-server_id=${server_id}';
    }
    return {
      ...opts,
      textureStyle: opts.textureStyle ?? 'none',
      serverDetailsUrl: serverDetailsUrl !== undefined ? serverDetailsUrl : '/d/dc-server-details?var-server_id=${server_id}',
      viewMode: opts.viewMode ?? '3d',
    };
  })
  .setPanelOptions((builder) => {
  return builder
    .addTextInput({
      path: 'text',
      name: 'Simple text option',
      description: 'Description of panel option',
      defaultValue: 'Default value of text input option',
    })
    .addBooleanSwitch({
      path: 'showSeriesCount',
      name: 'Show series counter',
      defaultValue: false,
    })
    .addRadio({
      path: 'seriesCountSize',
      defaultValue: 'sm',
      name: 'Series counter size',
      settings: {
        options: [
          { value: 'sm', label: 'Small' },
          { value: 'md', label: 'Medium' },
          { value: 'lg', label: 'Large' },
        ],
      },
      showIf: (config) => config.showSeriesCount,
    })
    .addColorPicker({
      path: 'bgColor',
      name: 'Background color',
      defaultValue: '#202020',
    })
    .addSliderInput({
      path: 'ambientIntensity',
      name: 'Ambient light',
      defaultValue: 0.6,
      settings: { min: 0, max: 3, step: 0.05 },
    })
    .addSliderInput({
      path: 'directionalIntensity',
      name: 'Directional light',
      defaultValue: 0.9,
      settings: { min: 0, max: 3, step: 0.05 },
    })
    .addSliderInput({
      path: 'fillLightIntensity',
      name: 'Fill / environment light',
      description: 'Lifts overall scene brightness (sky/ground fill). Use with ambient for a brighter view.',
      defaultValue: 0.7,
      settings: { min: 0, max: 2, step: 0.05 },
    })
    .addSliderInput({
      path: 'dirLightX',
      name: 'Dir light X',
      defaultValue: 5,
      settings: { min: -20, max: 20, step: 0.5 },
    })
    .addSliderInput({
      path: 'dirLightY',
      name: 'Dir light Y',
      defaultValue: 10,
      settings: { min: -20, max: 20, step: 0.5 },
    })
    .addSliderInput({
      path: 'dirLightZ',
      name: 'Dir light Z',
      defaultValue: 5,
      settings: { min: -20, max: 20, step: 0.5 },
    })
    .addBooleanSwitch({
      path: 'showGrid',
      name: 'Show grid',
      defaultValue: true,
    })
    .addBooleanSwitch({
      path: 'wireframe',
      name: 'Wireframe',
      defaultValue: false,
    })
    .addBooleanSwitch({
      path: 'skeleton',
      name: 'Skeleton edges',
      defaultValue: false,
    })
    .addRadio({
      path: 'viewMode',
      name: 'View mode',
      description: '2D = top-down orthographic (same scene, animations, and lighting). 3D = perspective with orbit.',
      defaultValue: '3d',
      settings: {
        options: [
          { value: '3d', label: '3D' },
          { value: '2d', label: '2D' },
        ],
      },
    })
    .addBooleanSwitch({
      path: 'autorotate',
      name: 'Autorotate',
      defaultValue: false,
    })
    .addColorPicker({
      path: 'barColor',
      name: 'Bar color',
      defaultValue: '#14b8a6',
    })
    .addSliderInput({
      path: 'barSharpness',
      name: 'Edge sharpness',
      defaultValue: 0.76,
      settings: { min: 0, max: 1, step: 0.02 },
    })
    .addBooleanSwitch({
      path: 'gradientEnabled',
      name: 'Gradient',
      defaultValue: false,
    })
    .addColorPicker({
      path: 'gradientTop',
      name: 'Gradient top',
      defaultValue: '#99f6e4',
    })
    .addColorPicker({
      path: 'gradientBottom',
      name: 'Gradient bottom',
      defaultValue: '#0d9488',
    })
    .addSelect({
      path: 'textureStyle',
      name: 'Texture',
      defaultValue: 'none',
      settings: {
        options: [
          { value: 'none', label: 'None' },
          { value: 'checker', label: 'Checker' },
          { value: 'dots', label: 'Dots' },
          { value: 'stripes', label: 'Stripes' },
          { value: 'glossy', label: 'Glossy (glass / metal)' },
        ],
      },
    })
    .addBooleanSwitch({
      path: 'simulationMode',
      name: 'Simulation mode',
      description:
        'When OFF: 3D view uses only what your backend/DC sends (backend-agnostic). Add queries for each metric you want to show (e.g. CPU, temperature, memory, alert); alert is only shown when the DC sends an alert metric. When ON: built-in demo data for testing.',
      defaultValue: false,
    })
    .addSliderInput({
      path: 'racksPerRow',
      name: 'Racks per row (columns)',
      description: 'Layout: more columns = wider layout; fewer rows = less depth. Set higher for a wide farm.',
      defaultValue: 8,
      settings: { min: 1, max: 16, step: 1 },
    })
    .addSliderInput({
      path: 'serversPerRack',
      name: 'Servers per rack',
      description: 'Layout: servers stacked per rack. Set to match your data (e.g. 8 for dc_simulator).',
      defaultValue: 8,
      settings: { min: 1, max: 48, step: 1 },
    })
    .addSliderInput({
      path: 'defaultServerCount',
      name: 'Default server count (no data)',
      description: 'When there is no query data (or in simulation), show this many server slots.',
      defaultValue: 64,
      settings: { min: 1, max: 500, step: 1 },
    })
    .addTextInput({
      path: 'serverDetailsUrl',
      name: 'Resource details URL',
      description:
        'Optional. Leave empty to hide the "View resource" link. Use /d/dc-server-details?var-server_id=${server_id} to open a details dashboard for the clicked server.',
      settings: { minLength: 0, placeholder: '/d/dc-server-details?var-server_id=${server_id}' },
      defaultValue: '',
    })
    .addTextInput({
      path: 'alertsUrl',
      name: 'Alerts URL (link from "X alerts" / "View alerts")',
      description:
        'Optional. Use /d/server-alerts?var-server_id=${server_id} to open the Server alerts dashboard for the clicked server. From a server tooltip the link includes that server\'s ID.',
      settings: { minLength: 0 },
    })
    .addBooleanSwitch({
      path: 'syncSelectionToVariable',
      name: 'Sync selection to dashboard variable',
      description:
        'When ON, selecting a server or rack in 3D updates the variable below so other panels on the dashboard filter to that selection.',
      defaultValue: false,
    })
    .addTextInput({
      path: 'syncSelectionVariableName',
      name: 'Variable name for selection',
      description: 'Dashboard variable to update (e.g. server_id). Also used: when the dashboard is opened with this variable set (e.g. from an alert link), the 3D view focuses on that server.',
      defaultValue: 'server_id',
      showIf: (config) => config.syncSelectionToVariable === true,
      settings: { minLength: 1 },
    })
    .addBooleanSwitch({
      path: 'showContextPanel',
      name: 'Show context panel on select',
      description: 'When ON, the pinned tooltip (after clicking a server or rack) also shows a "Runbook" link alongside Server details / Alerts.',
      defaultValue: false,
    })
    .addTextInput({
      path: 'runbookUrlTemplate',
      name: 'Runbook URL template',
      description:
        'Full URL (e.g. https://wiki.example.com/runbook?id=${server_id}) or Grafana path starting with / (e.g. /d/your-dashboard?var-server_id=${server_id}). Use ${server_id}, ${server_rack}, ${server_slot}.',
      settings: { minLength: 0, placeholder: 'https://... or /d/...' },
      showIf: (config) => config.showContextPanel === true,
    });
});
