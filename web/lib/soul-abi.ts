import { parseAbi } from 'viem';

export const soulAbi = parseAbi([
  'struct Soul { uint8 nightOwl; uint8 grinder; uint8 social; uint8 creator; uint32 level; uint16 ownerCount; }',
  'function batchSet(uint256[] ids, Soul[] souls)',
  'function getSoul(uint256 id) view returns (Soul)',
]);
