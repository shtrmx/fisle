export interface ShortcutBinding {
  readonly id: string;
  readonly keys: readonly string[];
  readonly altKeys?: readonly string[];
  readonly label: string;
}

export interface ShortcutGroup {
  readonly id:
    | 'units'
    | 'economy'
    | 'defense'
    | 'extra'
    | 'turn'
    | 'camera'
    | 'interface';
  readonly title: string;
  readonly items: readonly ShortcutBinding[];
}

/**
 * Single source of truth for all desktop (lg+) keyboard shortcuts in Fisle.
 * Physical `KeyboardEvent.code` matching ensures identical behavior on EN and RU layouts.
 */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    id: 'units',
    title: 'Юниты',
    items: [
      {id: 'unit-peasant', keys: ['1'], label: 'Крестьянин'},
      {id: 'unit-spearman', keys: ['2'], label: 'Копейщик'},
      {id: 'unit-baron', keys: ['3'], label: 'Барон'},
      {id: 'unit-knight', keys: ['4'], label: 'Рыцарь'},
      {id: 'unit-catapult', keys: ['5'], label: 'Катапульта'},
    ],
  },
  {
    id: 'economy',
    title: 'Прибыль',
    items: [
      {id: 'eco-farm', keys: ['6'], label: 'Ферма'},
      {id: 'eco-trading-post', keys: ['7'], label: 'Торговый посад'},
    ],
  },
  {
    id: 'defense',
    title: 'Защита',
    items: [
      {id: 'def-tower', keys: ['8'], label: 'Башня'},
      {id: 'def-strong-tower', keys: ['9'], label: 'Крепкая башня'},
    ],
  },
  {
    id: 'extra',
    title: 'Дополнительно',
    items: [
      {id: 'ext-beacon', keys: ['B'], label: 'Маяк (обзор 5)'},
      {id: 'ext-flare', keys: ['F'], label: 'Свет (разведка)'},
      {id: 'ext-regenerator', keys: ['R'], label: 'Регенератор'},
      {id: 'ext-demolish', keys: ['X'], label: 'Снос постройки'},
    ],
  },
  {
    id: 'turn',
    title: 'Ход и действия',
    items: [
      {
        id: 'turn-undo',
        keys: ['Z'],
        altKeys: ['Ctrl', 'Z'],
        label: 'Отмена хода',
      },
      {
        id: 'turn-end',
        keys: ['Space'],
        altKeys: ['Enter'],
        label: 'Завершить ход',
      },
      {id: 'turn-next-unit', keys: ['Tab'], label: 'Следующий готовый юнит'},
      {id: 'turn-esc', keys: ['Esc'], label: 'Снять выбор / Пауза'},
    ],
  },
  {
    id: 'camera',
    title: 'Карта и камера',
    items: [
      {id: 'cam-pan', keys: ['↑', '↓', '←', '→'], label: 'Передвижение по карте'},
      {id: 'cam-pan-fast', keys: ['Shift', '↑↓←→'], label: 'Ускоренное перемещение'},
      {id: 'cam-orbit', keys: ['Q', 'E'], label: 'Поворот камеры'},
      {id: 'cam-zoom', keys: ['+', '-'], label: 'Приближение / отдаление'},
      {id: 'cam-mode', keys: ['V'], label: 'Режим камеры (Авто / 2D / 3D)'},
      {id: 'cam-reset', keys: ['0'], altKeys: ['Home'], label: 'Сброс вида карты'},
    ],
  },
  {
    id: 'interface',
    title: 'Меню и интерфейс',
    items: [
      {id: 'ui-diplomacy', keys: ['D'], label: 'Дипломатия'},
      {id: 'ui-notifications', keys: ['N'], label: 'История сообщений'},
      {id: 'ui-chat', keys: ['C'], label: 'Чат комнаты (онлайн)'},
      {id: 'ui-overview', keys: ['I'], label: 'Партия и игроки'},
      {id: 'ui-hud', keys: ['H'], label: 'Скрыть / показать панель'},
      {id: 'ui-fullscreen', keys: ['Ctrl', 'F'], label: 'Полный экран'},
      {id: 'ui-pause', keys: ['P'], label: 'Меню паузы'},
      {id: 'ui-help', keys: ['Ctrl', '/'], label: 'Справка по клавишам'},
    ],
  },
];
