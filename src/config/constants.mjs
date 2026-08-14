// Enumerations used across config, storage migrations, and provider
// predicates. Pure data — no imports.

export const TriggerMode = {
  always: 'Always',
  questionMark: 'When query ends with question mark (?)',
  manually: 'Manually',
}

export const ThemeMode = {
  light: 'Light',
  dark: 'Dark',
  auto: 'Auto',
}

export const ModelStatus = {
  active: 'active',
  deprecated: 'deprecated',
}
