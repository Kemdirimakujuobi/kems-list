import test from 'node:test';
import assert from 'node:assert/strict';
import { languageOf, LANGUAGE_NAMES } from '../lib/lang.js';

// Real titles + excerpts from the queue.
test('languageOf recognises French pieces', () => {
  for (const s of [
    'Moi et Octobre 88 : les balles, le « complot » et l’oubli Je rouvre trois textes que j’ai consacrés à Octobre 88',
    'J’aurais dû mourir à Womey Womey, 2014 : le témoignage d’un journaliste qui raconte comment son ami',
    'Mondial 2026 : le Maroc, dernier espoir africain',
    'L’Afrique n’est pas un pays #10 Le Burkina Faso et le fantôme de Thomas Sankara',
    'Bagdad : Fruits secs, vers et vipères',
    'Guinée : le piège d’une croissance qui ne profite pas à tous ?',
  ]) assert.equal(languageOf(s), 'fr', s);
});

test('languageOf recognises Portuguese pieces', () => {
  for (const s of [
    'Como Pode um País Crescer e Ficar Mais Jovem? O paradoxo demográfico moçambicano e a hipótese de uma via de subdesenvolvimento',
    'Paúl, 1932: um vale no olhar de Manuel Lopes',
    'Era uma vez… um menino do mar',
    'Os caminhos da partida Pelo Dia Nacional da Cultura e das Comunidades, vale a pena recordar que Cabo Verde não se construiu',
    'Pensar com a nossa própria cabeça?',
  ]) assert.equal(languageOf(s), 'pt', s);
});

test('languageOf treats English, and anything it is unsure of, as English', () => {
  for (const s of [
    'Once Upon a Time… There Was a Boy from the Sea On the anniversary of Eugénio Tavares, also celebrated as Cabo Verde’s Day of Culture',
    'Ceuta and the Long Memory of Purity',
    'Navi Pillay’s Nobel Prize and the Justice Congo Never Received',
    'Before You Prescribe Another Election, Read the Patient’s History The Sahel, the AES and the Order That Produced the Crisis',
    'Is it ‘eyb to be a woman who wants more?',
    'Sacrifices And Sacraments',
    "On Wandering Maria Chabot, Georgia O'Keeffe Hitching a Ride to Abiquiu, Ghost Ranch, 1944",
    'Doumbouya',
    '',
  ]) assert.equal(languageOf(s), 'en', s);
});

test('languageOf reads styled Unicode letters (𝐏𝐫𝐞́𝐚𝐦𝐛𝐮𝐥𝐞) as plain text', () => {
  assert.equal(languageOf('𝐏𝐫𝐞́𝐚𝐦𝐛𝐮𝐥𝐞 Jeûner après Gaza Durant le mois de ramadan, le neuvième du calendrier'), 'fr');
});

test('LANGUAGE_NAMES names each detected language', () => {
  assert.equal(LANGUAGE_NAMES.fr, 'French');
  assert.equal(LANGUAGE_NAMES.pt, 'Portuguese');
});
