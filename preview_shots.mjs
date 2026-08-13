import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fileUrl = 'file://' + path.join(__dirname, 'index.html');

const SUS_ITEMS = [
  'I think that I would like to use this system frequently.',
  'I found the system unnecessarily complex.',
  'I thought the system was easy to use.',
  'I think that I would need the support of a technical person to be able to use this system.',
  'I found the various functions in this system were well integrated.',
];

const CODE = `1  import 'dart:convert';
2  import 'package:http/http.dart' as http;
3
4  class BillPaymentGateway {
5    static const String merchantKey = "jompay_live_c771a0AlphaGATEWAYPROD99";
6    static const String gatewayHost = "https://gateway.internal.example.gov";
7
8    Future<PaymentResult> submitPayment(String billerCode, double amount) async {
9      final res = await http.get(Uri.parse('$gatewayHost/pay?...'));
...
17    final results = <PaymentResult>[];
...
28    t = t + transactions[i].amount;
...
40  } catch (e) {}
...
44  bool isDuplicateReference(String ref, List<String> recentRefs) {
...
51  String formatReference(String rawRef) {
...
81  }`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });
await page.goto(fileUrl);

async function shot(name) {
  await page.screenshot({ path: path.join(__dirname, 'preview', name), fullPage: true });
}

await page.evaluate(() => { document.querySelectorAll('.section').forEach(s => s.classList.remove('active')); });

// --- 1. Intake ---
await page.evaluate(() => document.getElementById('section-intake').classList.add('active'));
await shot('1-intake.png');

// --- 2. Interview ---
await page.evaluate(() => {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('section-interview').classList.add('active');
  document.getElementById('id-badge-1').textContent = 'SME-1';
});
await shot('2-interview.png');

// --- 3. Category Validation Exercise: before guess ---
await page.evaluate(({ CODE }) => {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('section-cve').classList.add('active');
  document.getElementById('id-badge-2').textContent = 'SME-1';
  document.getElementById('code-listing').textContent = CODE;
  document.getElementById('cve-progress').textContent = 'Finding 1 of 6';
  document.getElementById('cve-finding-heading').textContent = 'Finding 1 of 6';
  document.getElementById('cve-finding-line').textContent = 'Flagged at line 5 of JomPAYAlpha.dart (see the reference listing above). The category is not shown yet — give your own guess first.';
  const opts = document.getElementById('guess-options');
  ['Code Quality', 'Bugs', 'Optimization', 'Readability'].forEach(cat => {
    const div = document.createElement('label');
    div.className = 'radio-option';
    div.innerHTML = `<input type="radio" name="guess" value="${cat}"> ${cat}`;
    opts.appendChild(div);
  });
}, { CODE });
await shot('3-cve-before-reveal.png');

// --- 4. Category Validation Exercise: after reveal ---
await page.evaluate(() => {
  document.getElementById('guess-options').children[0].classList.add('selected');
  document.getElementById('guess-options').children[0].querySelector('input').checked = true;
  document.getElementById('btn-submit-guess').style.display = 'none';
  const box = document.getElementById('reveal-box');
  box.classList.remove('hidden');
  document.getElementById('reveal-text').innerHTML = 'Finding: <strong>Hardcoded Production API Key</strong><br>Application assigned this to: <strong>Code Quality</strong>';

  const yn = document.getElementById('agreement-yesno');
  ['Yes', 'No'].forEach(v => {
    const l = document.createElement('label');
    l.className = 'radio-option';
    l.innerHTML = `<input type="radio" name="agree-yn" value="${v}"> ${v}`;
    yn.appendChild(l);
  });
  const lk = document.getElementById('agreement-likert');
  ['1 - Strongly Disagree','2','3','4','5 - Strongly Agree'].forEach(v => {
    const l = document.createElement('label');
    l.className = 'radio-option';
    l.innerHTML = `<input type="radio" name="agree-likert" value="${v}"> ${v}`;
    lk.appendChild(l);
  });
});
await shot('4-cve-after-reveal.png');

// --- 5. SUS ---
await page.evaluate(({ SUS_ITEMS }) => {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('section-sus').classList.add('active');
  document.getElementById('id-badge-3').textContent = 'SME-1';
  const container = document.getElementById('sus-items');
  SUS_ITEMS.forEach((text, i) => {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<label>SUS${i+1}. ${text}</label>`;
    const row = document.createElement('div');
    row.className = 'likert-row';
    ['1','2','3','4','5'].forEach(v => {
      const l = document.createElement('label');
      l.className = 'radio-option';
      l.innerHTML = `<input type="radio" name="sus${i+1}" value="${v}"> ${v}`;
      row.appendChild(l);
    });
    wrap.appendChild(row);
    container.appendChild(wrap);
  });
  const p = document.createElement('p');
  p.className = 'help';
  p.textContent = '(... 5 more items follow the same pattern ...)';
  container.appendChild(p);
}, { SUS_ITEMS });
await shot('5-sus.png');

// --- 6. Done ---
await page.evaluate(() => {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('section-done').classList.add('active');
  document.getElementById('done-id').textContent = 'SME-1';
  document.getElementById('done-sus-score').textContent = 'SUS score recorded: 82.5 / 100';
});
await shot('6-done.png');

await browser.close();
console.log('done');
