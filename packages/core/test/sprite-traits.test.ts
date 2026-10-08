import { describe, expect, it } from 'vitest';
import { hatStyle, outfitStyle, traitValue } from '../src/sprite';

const t = (o: Record<string, string>) => Object.entries(o).map(([trait_type, value]) => ({ trait_type, value }));

describe('outfitStyle', () => {
  it.each([
    ['Red Tuxedo', 'suit'],
    ['Black Blazer', 'suit'],
    ['Grey Hoodie', 'hoodie'],
    ['Blue Chinese', 'robe'],
    ['Hawaiian Polo', 'shirt'],
    ['Stripes', 'shirt'],
    ['Guko', 'shirt'],
  ])('%s -> %s', (body, style) => {
    expect(outfitStyle(t({ Body: body }))).toBe(style);
  });
  it('Naked=Yes or no Body is bare', () => {
    expect(outfitStyle(t({ Body: 'Red Tuxedo', Naked: 'Yes' }))).toBe('bare');
    expect(outfitStyle([])).toBe('bare');
  });
});

describe('hatStyle', () => {
  it.each([
    ['MMGA Cap', 'cap'],
    ['Thunder Cap', 'cap'],
    ['Wizard Hat', 'wizard'],
    ['Blue Bucket Hat', 'bucket'],
    ['Red Horn', 'horns'],
    ['Red Headband', 'headband'],
    ['Gold Crown', 'crown'],
    ['Something New', 'none'],
  ])('%s -> %s', (head, style) => {
    expect(hatStyle(t({ Head: head }))).toBe(style);
  });
  it('no Head trait is none', () => {
    expect(hatStyle([])).toBe('none');
  });
});

describe('traitValue', () => {
  it('finds a value case-sensitively by type', () => {
    expect(traitValue(t({ Side: 'Left' }), 'Side')).toBe('Left');
    expect(traitValue(t({ Side: 'Left' }), 'Body')).toBeUndefined();
  });
});
