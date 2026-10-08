import { describe, expect, it } from 'vitest';
import { hatStyle, outfitStyle, traitValue } from '../src/sprite';
import * as fs from 'fs';
import * as path from 'path';

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

describe('real trait values from meta.jsonl', () => {
  it('outfitStyle and hatStyle handle all real Body/Head values without throwing', () => {
    // Try to load real metadata file
    const metaPath = '/private/tmp/claude-501/-Users-zorak-Desktop-chogaton/229f91a9-3a75-4e9b-997f-c8b677142c75/scratchpad/meta.jsonl';

    if (!fs.existsSync(metaPath)) {
      // Fallback: inline real values extracted from the file
      const realBodies = [
        'Red Tuxedo', 'Tuxedo', 'Blue tuxedo', 'Gangster suit',
        'Dragon suit', 'Astro Suit', 'Banana suit', 'Shark Suit',
        'White Yukata', 'Wizard', 'Jesus', 'Jesus Robe', 'Wizard Cape',
        'Yellow Shirt', 'Black Shirt', 'Blue Homeless Shirt',
        'Army Vest', 'Black Trackset', 'Blue Mafia', 'CEO Vest',
      ];
      const realHeads = [
        'MMGA Cap', 'Horny Cap', 'Dollar Cap',
        'Blue Bucket Cap', 'Gray Bucket Cap',
        'Wizard Hat', 'Wizard Beanie',
        'Red Horn', 'Purple Horn', 'Demon Horn',
        'Red Headband', 'Crown',
        'Robber', 'Peace hat', 'NEET',
      ];

      realBodies.forEach((body) => {
        const style = outfitStyle(t({ Body: body }));
        expect(style).toMatch(/suit|shirt|hoodie|robe|bare/);
      });

      realHeads.forEach((head) => {
        const style = hatStyle(t({ Head: head }));
        expect(style).toMatch(/cap|bucket|wizard|horns|headband|crown|none/);
      });
      return;
    }

    // Load from file if available
    const lines = fs.readFileSync(metaPath, 'utf-8').split('\n').filter(Boolean);
    const bodyValues = new Set<string>();
    const headValues = new Set<string>();

    lines.forEach((line) => {
      try {
        const meta = JSON.parse(line);
        meta.attributes?.forEach((attr: { trait_type: string; value: string }) => {
          if (attr.trait_type === 'Body') bodyValues.add(attr.value);
          if (attr.trait_type === 'Head') headValues.add(attr.value);
        });
      } catch {
        // Skip unparseable lines
      }
    });

    // Test all unique Body values
    bodyValues.forEach((body) => {
      const style = outfitStyle(t({ Body: body }));
      expect(style).toMatch(/suit|shirt|hoodie|robe|bare/);
    });

    // Test all unique Head values
    headValues.forEach((head) => {
      const style = hatStyle(t({ Head: head }));
      expect(style).toMatch(/cap|bucket|wizard|horns|headband|crown|none/);
    });

    // Verify file had substantial data
    expect(bodyValues.size).toBeGreaterThan(10);
    expect(headValues.size).toBeGreaterThan(10);
  });
});
