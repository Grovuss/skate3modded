// The subset of game cvars the in-game settings menu persists to settings.toml
// (rexglue simple_settings_overlay.cpp). Keys, defaults and choices mirror the
// game so both UIs edit the same file the same way.

export type SettingType = 'bool' | 'int' | 'float' | 'string'

export interface Choice {
  label: string
  value: string | number
}

export interface SettingDef {
  key: string
  type: SettingType
  label: string
  hint?: string
  default: string | number | boolean
  /** Rendered as a select when present, otherwise bool = toggle, number = slider. */
  choices?: Choice[]
  min?: number
  max?: number
  step?: number
  /** Other keys the game keeps in lockstep with this one. */
  mirrors?: string[]
  windowsOnly?: boolean
}

export interface SettingSection {
  id: string
  title: string
  settings: SettingDef[]
}

export const SETTING_SECTIONS: SettingSection[] = [
  {
    id: 'video',
    title: 'Video',
    settings: [
      {
        key: 'skate3_native_render_scene',
        type: 'bool',
        label: 'Native renderer',
        hint: 'Draw the game directly through Direct3D 12 / Vulkan instead of emulating the Xbox 360 GPU. F5 toggles it in game.',
        default: true
      },
      {
        key: 'gpu_backend',
        type: 'string',
        label: 'Graphics API',
        default: 'auto',
        choices: [
          { label: 'Auto', value: 'auto' },
          { label: 'DirectX 12', value: 'd3d12' },
          { label: 'Vulkan', value: 'vulkan' }
        ],
        windowsOnly: true
      },
      {
        key: 'resolution_scale',
        type: 'int',
        label: 'Resolution',
        default: 2,
        choices: [
          { label: '720p (1x)', value: 1 },
          { label: '1440p (2x)', value: 2 },
          { label: '2160p (3x)', value: 3 }
        ],
        mirrors: ['draw_resolution_scale_x', 'draw_resolution_scale_y']
      },
      { key: 'fullscreen', type: 'bool', label: 'Fullscreen', default: true },
      {
        key: 'skate3_ultrawide',
        type: 'bool',
        label: 'True ultrawide',
        hint: 'Experimental. Renders the world at 21:9 and wider; needs the native renderer.',
        default: false
      },
      {
        key: 'skate3_field_of_view',
        type: 'float',
        label: 'Field of view',
        default: 60,
        min: 40,
        max: 120,
        step: 1
      },
      { key: 'vsync', type: 'bool', label: 'VSync', default: false },
      {
        key: 'monitor',
        type: 'int',
        label: 'Monitor',
        default: 0,
        choices: [
          { label: 'Auto', value: 0 },
          { label: 'Monitor 1', value: 1 },
          { label: 'Monitor 2', value: 2 },
          { label: 'Monitor 3', value: 3 },
          { label: 'Monitor 4', value: 4 }
        ]
      },
      { key: 'show_fps_counter', type: 'bool', label: 'FPS counter', default: false },
      {
        key: 'skate3_native_render_mode_indicator',
        type: 'bool',
        label: 'Renderer indicator',
        hint: 'Corner readout of which renderer drew the frame.',
        default: false
      }
    ]
  },
  {
    id: 'graphics',
    title: 'Graphics',
    settings: [
      {
        key: 'skate3_native_render_scene_msaa',
        type: 'int',
        label: 'Anti-aliasing (MSAA)',
        default: 4,
        choices: [
          { label: 'Off', value: 1 },
          { label: '2x', value: 2 },
          { label: '4x', value: 4 },
          { label: '8x', value: 8 }
        ]
      },
      { key: 'skate3_native_render_scene_shadows', type: 'bool', label: 'Dynamic shadows', default: true },
      {
        key: 'skate3_native_render_scene_shadow_tile',
        type: 'int',
        label: 'Dynamic shadow resolution',
        default: 0,
        choices: [
          { label: 'Auto', value: 0 },
          { label: '512 (console)', value: 512 },
          { label: '1024', value: 1024 },
          { label: '1536', value: 1536 },
          { label: '2048', value: 2048 }
        ]
      },
      {
        key: 'skate3_native_render_scene_shadow_static_casters',
        type: 'bool',
        label: 'Enhanced sun shadows',
        hint: 'Real-time shadows from buildings, trees and rails.',
        default: true
      },
      {
        key: 'skate3_native_render_scene_shadow_static_size',
        type: 'int',
        label: 'Sun shadow resolution',
        default: 4096,
        choices: [
          { label: '1024', value: 1024 },
          { label: '2048', value: 2048 },
          { label: '4096', value: 4096 },
          { label: '8192', value: 8192 }
        ]
      },
      { key: 'skate3_native_render_scene_shadow_pcss', type: 'bool', label: 'Soft shadows', default: true },
      { key: 'skate3_native_render_scene_ssao', type: 'bool', label: 'Ambient occlusion', default: true },
      { key: 'skate3_native_render_scene_bloom', type: 'bool', label: 'Bloom', default: true },
      { key: 'skate3_native_render_scene_shafts', type: 'bool', label: 'Volumetric lighting', default: true },
      { key: 'skate3_native_render_scene_haze', type: 'bool', label: 'Atmospheric haze', default: true },
      {
        key: 'skate3_draw_distance_scale',
        type: 'float',
        label: 'Draw distance',
        default: 2,
        choices: [
          { label: 'Original', value: 1 },
          { label: '2x', value: 2 },
          { label: '3x', value: 3 },
          { label: '5x', value: 5 }
        ],
        mirrors: ['skate3_lod_distance_scale']
      },
      {
        key: 'skate3_draw_distance_stream_probe',
        type: 'float',
        label: 'World streaming',
        hint: 'How far ahead neighbouring world cells are pre-loaded.',
        default: 0,
        choices: [
          { label: 'Original', value: 0 },
          { label: 'Near (100 m)', value: 100 },
          { label: 'Extended (200 m)', value: 200 },
          { label: 'Far (300 m)', value: 300 }
        ]
      }
    ]
  },
  {
    id: 'controls',
    title: 'Controls',
    settings: [
      {
        key: 'input_backend',
        type: 'string',
        label: 'Controller backend',
        hint: 'SDL supports PlayStation, Switch and generic controllers.',
        default: 'xinput',
        choices: [
          { label: 'XInput', value: 'xinput' },
          { label: 'SDL', value: 'sdl' }
        ],
        windowsOnly: true
      },
      { key: 'hid_rumble_enabled', type: 'bool', label: 'Vibration', default: true },
      {
        key: 'menu_chord',
        type: 'string',
        label: 'Settings menu shortcut',
        default: 'rb+start',
        choices: [
          { label: 'RB + Start', value: 'rb+start' },
          { label: 'LB + RB + Start', value: 'lb+rb+start' },
          { label: 'Back + Start', value: 'back+start' },
          { label: 'L3 + R3', value: 'l3+r3' }
        ]
      },
      { key: 'mnk_mode', type: 'bool', label: 'Mouse & keyboard mode', default: false },
      { key: 'mnk_capture_mouse', type: 'bool', label: 'Capture mouse', default: false },
      {
        key: 'mnk_sensitivity',
        type: 'float',
        label: 'Mouse sensitivity',
        default: 1,
        min: 0.1,
        max: 10,
        step: 0.1
      }
    ]
  },
  {
    id: 'audio',
    title: 'Audio',
    settings: [
      { key: 'audio_mute', type: 'bool', label: 'Mute', default: false },
      {
        key: 'audio_device_sample_frames',
        type: 'int',
        label: 'Audio buffer',
        hint: 'Larger buffers add latency but fix crackling.',
        default: 0,
        choices: [
          { label: 'Auto', value: 0 },
          { label: '512 (low latency)', value: 512 },
          { label: '1024', value: 1024 },
          { label: '2048 (most stable)', value: 2048 }
        ]
      }
    ]
  }
]

/** Type of every key the launcher is allowed to write, mirrored keys included. */
export const SETTING_TYPES: ReadonlyMap<string, SettingType> = new Map(
  SETTING_SECTIONS.flatMap((section) =>
    section.settings.flatMap((def) =>
      [def.key, ...(def.mirrors ?? [])].map((key) => [key, def.type] as const)
    )
  )
)
