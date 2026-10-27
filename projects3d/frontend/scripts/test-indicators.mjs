import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const source = await readFile(new URL('../src/ui/ProjectPanels.ts', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('const numberFormat'), source.indexOf('export function mountProjectPanels'));
const { formatIndicator } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(code)).toString('base64')}`);

for (const [value, label, expected] of [
  ['0.605', 'Eficiência', '60,5%'],
  ['0,6', 'Eficiência', '60,0%'],
  ['0.22', 'Taxa de ocupação', '22,00%'],
  ['0', 'Taxa de ocupação', '0,00%'],
  ['8', 'Índice de elevação', '8,00'],
  ['112219.01', 'Área construída total', '112.219,01 m²'],
  ['6045.38', 'Estacionamento térreo', '6.045,38 m²'],
  ['51794.2', 'Área do terreno', '51.794,20 m²'],
  ['58,07', 'Área média un. priv.', '58,07 m²'],
  ['1210', 'Total Vagas', '1.210'],
  ['1.77', 'CA', '1,77'],
  ['', 'Área ocupada', 'Não informado'],
  ['A confirmar', 'Área ocupada', 'A confirmar'],
]) {
  assert.equal(formatIndicator(value, label), expected, `${label}: ${value}`);
}
console.log('Indicator formatting tests passed.');
