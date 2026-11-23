import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc16, gerarPixCopiaECola } from '../js/pix.js';

test('CRC16 confere com o exemplo do manual do Banco Central', () => {
  const ex = '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304';
  assert.equal(crc16(ex), '1D3D');
});

test('gera Pix com valor, nome sem acento e txid limpo', () => {
  const p = gerarPixCopiaECola({ chave: 'chave@x.com', nome: 'Condomínio Sol', cidade: 'São Paulo', valor: 850, txid: 'AB-12' });
  assert.match(p, /^000201/);
  assert.ok(p.includes('5406850.00'));
  assert.ok(p.includes('CONDOMINIO SOL'));
  assert.ok(p.includes('0504AB12'));
  assert.equal(p.slice(-4), crc16(p.slice(0, -4)));
});
