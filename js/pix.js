// Gera o "Pix Copia e Cola" (BR Code / EMV) — padrão do Banco Central.
// Funciona com QUALQUER chave Pix, sem API de banco e sem custo.

function campo(id, valor) {
  const v = String(valor);
  return id + String(v.length).padStart(2, '0') + v;
}

function semAcento(txt, max) {
  return String(txt || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .\-]/g, '')
    .toUpperCase().trim().slice(0, max);
}

export function crc16(payload) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * @param {object} o
 * @param {string} o.chave      chave Pix (e-mail, CPF/CNPJ, telefone +55..., aleatória)
 * @param {string} o.nome       nome do recebedor (até 25)
 * @param {string} o.cidade     cidade do recebedor (até 15)
 * @param {number} [o.valor]    valor em reais
 * @param {string} [o.txid]     identificador (até 25, letras/números)
 * @param {string} [o.descricao]
 */
export function gerarPixCopiaECola({ chave, nome, cidade, valor, txid, descricao }) {
  const conta =
    campo('00', 'br.gov.bcb.pix') +
    campo('01', String(chave).trim()) +
    (descricao ? campo('02', semAcento(descricao, 40)) : '');
  const id = (String(txid || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25)) || '***';

  let p =
    campo('00', '01') +
    campo('26', conta) +
    campo('52', '0000') +
    campo('53', '986') +
    (valor ? campo('54', Number(valor).toFixed(2)) : '') +
    campo('58', 'BR') +
    campo('59', semAcento(nome, 25) || 'RECEBEDOR') +
    campo('60', semAcento(cidade, 15) || 'BRASIL') +
    campo('62', campo('05', id)) +
    '6304';
  return p + crc16(p);
}

// Desenha o QR Code (usa a biblioteca qrcode-generator carregada no index.html)
export function qrSvg(texto, tamanhoCelula = 4) {
  if (!window.qrcode) return '';
  const qr = window.qrcode(0, 'M');
  qr.addData(texto);
  qr.make();
  return qr.createSvgTag({ cellSize: tamanhoCelula, margin: 2, scalable: true });
}
