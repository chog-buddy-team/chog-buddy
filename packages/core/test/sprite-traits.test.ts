import { describe, expect, it } from 'vitest';
import { hatStyle, outfitStyle, traitValue } from '../src/sprite';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const t = (o: Record<string, string>) => Object.entries(o).map(([trait_type, value]) => ({ trait_type, value }));

describe('outfitStyle', () => {
  it.each([
    // Real business suit values
    ['Red Tuxedo', 'suit'],
    ['Tuxedo', 'suit'],
    ['Blue tuxedo', 'suit'],
    ['Gangster suit', 'suit'],
    // Real costume suit values (map to shirt, not suit)
    ['Dragon suit', 'shirt'],
    ['Astro Suit', 'shirt'],
    ['Banana suit', 'shirt'],
    ['Shark Suit', 'shirt'],
    ['Toad green Suit', 'shirt'],
    // Real robe values
    ['White Yukata', 'robe'],
    ['Wizard', 'robe'],
    ['Jesus', 'robe'],
    ['Jesus Robe', 'robe'],
    ['Wizard Cape', 'robe'],
    // Real shirt values
    ['Yellow Shirt', 'shirt'],
    ['Black Shirt', 'shirt'],
    ['Blue Homeless Shirt', 'shirt'],
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
    // Real cap values
    ['MMGA Cap', 'cap'],
    ['Horny Cap', 'cap'],
    ['Dollar Cap', 'cap'],
    // Real bucket values
    ['Blue Bucket Cap', 'bucket'],
    ['Gray Bucket Cap', 'bucket'],
    // Real wizard values
    ['Wizard Hat', 'wizard'],
    ['Wizard Beanie', 'wizard'],
    // Real horn values
    ['Red Horn', 'horns'],
    ['Purple Horn', 'horns'],
    ['Demon Horn', 'horns'],
    // Real headband values
    ['Red Headband', 'headband'],
    // Real crown values
    ['Crown', 'crown'],
    // Unknown Head value
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

describe('real trait values from fixtures', () => {
  it('outfitStyle and hatStyle handle all real Body/Head values without throwing', () => {
    // Load fixture relative to test file
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const fixturePath = join(__dirname, 'fixtures', 'chog-traits.json');

    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8')) as {
      Head: string[];
      Body: string[];
      Naked: string[];
    };

    // Test all unique Body values
    fixture.Body.forEach((body) => {
      const style = outfitStyle(t({ Body: body }));
      expect(style).toMatch(/suit|shirt|hoodie|robe|bare/);
    });

    // Test all unique Head values
    fixture.Head.forEach((head) => {
      const style = hatStyle(t({ Head: head }));
      expect(style).toMatch(/cap|bucket|wizard|horns|headband|crown|none/);
    });

    // Verify fixture had substantial data
    expect(fixture.Body.length).toBeGreaterThan(10);
    expect(fixture.Head.length).toBeGreaterThan(10);
  });
});
