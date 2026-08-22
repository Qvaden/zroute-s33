export const PRESIDENT_BOARD_KEY = 'president-board';

export const DEFAULT_PRESIDENT_BOARD = {
  enabled: true,
  label: 'ПРЕЗИДЕНТ СЕРВЕРА',
  name: 'Имя президента',
  alliance: 'Альянс президента',
  note: 'Данные обновляются вручную',
};

export function normalizePresidentBoard(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    enabled: source.enabled !== false,
    label: String(source.label ?? DEFAULT_PRESIDENT_BOARD.label),
    name: String(source.name ?? DEFAULT_PRESIDENT_BOARD.name),
    alliance: String(source.alliance ?? DEFAULT_PRESIDENT_BOARD.alliance),
    note: String(source.note ?? DEFAULT_PRESIDENT_BOARD.note),
  };
}

export function parsePresidentBoard(text) {
  try {
    const value = JSON.parse(String(text?.body ?? ''));
    return normalizePresidentBoard(value);
  } catch {
    return { ...DEFAULT_PRESIDENT_BOARD };
  }
}

export function serializePresidentBoard(value) {
  return JSON.stringify(normalizePresidentBoard(value));
}

export function presidentBoardFromTexts(texts = []) {
  const entry = texts.find((text) => text.key === PRESIDENT_BOARD_KEY);
  return parsePresidentBoard(entry);
}
