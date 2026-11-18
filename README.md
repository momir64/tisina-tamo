# Tišina tamo

Dosta je bilo slušanja i gledanja picoustong i ostale bagre. Tišina tamo im momentalno gasi mikrofon i bluruje sliku na YouTube prenosu skupštine čim se pojave na ekranu. Kada je vazduh ponovo čist zvuk i slika se vraćaju nazad.

## Instalacija

Dodatak je dostupan za Chrome i Firefox, a instalira se preko jednog od dugmadi ispod:

<p>
  <a href="https://chromewebstore.google.com/detail/ti%C5%A1ina-tamo/hpdkgkljlggfbkdoljmgfkhkpphdahom"><img src="https://developer.chrome.com/static/docs/webstore/branding/image/HRs9MPufa1J1h5glNhut.png" alt="Available in the Chrome Web Store" height="58"></a>&nbsp;
  <a href="https://addons.mozilla.org/en-US/firefox/addon/ti%C5%A1ina-tamo/"><img src="https://blog.mozilla.org/addons/files/2020/04/get-the-addon-fx-apr-2020.svg" alt="Get the Add-on for Firefox" height="58"></a>
</p>

## Kako radi

U prenosima skupštine ime govornika je ispisano belim slovima na dnu ekrana. Dodatak nekoliko puta u
sekundi „fotografiše“ taj deo videa, pročita tekst (OCR, ćirilica) i proveri da li se u njemu nalazi
neka od zadatih fraza. Ako se nalazi, video se utišava; kad fraza nestane, zvuk se vraća.

- Radi samo na videima sa kanala **@ParlamentSrbija** (ugrađeno u kod).
- Sve se izvršava lokalno u pregledaču. Ništa se ne šalje na internet.
- Utišava preko `video.muted` i vraća zvuk samo ako ga je sam utišao. Reklame i pauzirani video se preskaču.

### Podrazumevane fraze

`Александар Вучић`, `Србија побеђује`, `Вучић`. U iskačućem prozoru se može dodati ili ukloniti koliko god je potrebno.
Fraze se mogu kucati ćirilicom ili latinicom, svejedno je.

## Podešavanja (klik na ikonu dodatka)

| Podešavanje | Šta radi |
|---|---|
| Uključeno (prekidač gore) | Glavni prekidač. Ikona u traci se menja kad je dodatak uključen/isključen. |
| Utišaj kada je vidljivo | Lista fraza (čipovi). Dovoljno je da se pojavi bilo koja. |
| Razlikuj velika i mala slova | Isključeno po defaultu. |
| Oblast skeniranja | Deo kadra koji se čita, u procentima (levo, gore, širina, visina). Što je manji, brže je i tačnije. Default je traka pri dnu ekrana. |
| Interval skeniranja | Pauza između skeniranja u milisekundama (default 300). |
| Uzastopnih skeniranja | Koliko skeniranja zaredom mora da se složi pre promene stanja zvuka (default 3). Sprečava treperenje zbog pogrešno pročitanog kadra. |
| Osetljivost na bela slova | Tekst na ekranu je čisto bele boje, pa se čitaju samo dovoljno svetli pikseli. Ako se tekst ne hvata, vrednost treba smanjiti; ako smeta pozadina, povećati. |
| Tolerancija grešaka | Koliko pogrešno pročitanih slova se toleriše pri poređenju fraze (default 1). Veće vrednosti hvataju više, ali su i češći lažni pogoci. |
| Dijagnostički prikaz | Prikazuje u uglu stranice šta dodatak vidi: isečak videa, masku belog, pročitani tekst i stanje zvuka. Radi i kad je dodatak isključen (tada samo prikazuje, ne menja zvuk). |

Svako podešavanje se čuva automatski. Dugme „Vrati podrazumevana podešavanja“ vraća sve na početno.

## Poznata ograničenja

- Kad je kartica u pozadini ili prozor prekriven, pregledač prestaje da crta video, pa dodatak ne može da
  čita tekst. Tada ostaje u stanju u kojem je bio i nastavlja čim se kartica ponovo prikaže.
- OCR nije savršen. Ako ime ne bude uhvaćeno, mogu pomoći manja oblast skeniranja, drugačija osetljivost na
  bela slova ili veća tolerancija grešaka. Dijagnostički prikaz pokazuje šta se zapravo čita.
- Radi samo na veb-sajtu (`youtube.com`, `m.youtube.com`), ne u YouTube aplikaciji.

## Telefoni

- Radi na `m.youtube.com` u pregledačima koji podržavaju dodatke na telefonu: **Firefox za Android**
  (Firefox verzija) i Chromium pregledači za Android koji dozvoljavaju dodatke, npr. Kiwi (Chrome verzija).
  Chrome za Android i YouTube aplikacija ne podržavaju dodatke.
- Na ekranima osetljivim na dodir iskačući prozor se prilagođava ekranu, a fraze se dodaju dugmetom **+**
  ili zarezom.
- Na telefonu je OCR sporiji i koristi manje slike. Veći „Interval skeniranja“ štedi bateriju.
- **Firefox za Android:** da bi dodatak mogao da vidi sliku videa, u `about:config` treba postaviti
  `media.hardware-video-decoding.enabled` na `false` i restartovati pregledač. Bez toga pregledač dodatku
  daje praznu sliku i ništa se ne utišava.

## Za programere

### Struktura
```
manifest.chrome.json     Chrome manifest (service worker + offscreen dokument)
manifest.firefox.json    Firefox manifest (pozadinska stranica)
build.py                 Pravi dist/*.zip za oba pregledača
icons/                   iconNN.png = uključeno, iconNN_off.png = isključeno (16/32/48/128); source/ sadrži SVG
src/
  background/            Service worker / pozadinska skripta (prosleđuje OCR zahteve)
  content/               Radi na youtube.com: prepoznaje kanal, skenira kadrove, utišava
  ocr/                   Tesseract omotač (+ offscreen stranica samo za Chrome)
  popup/                 Iskačući prozor sa podešavanjima (html, css, js)
vendor/                  Tesseract.js, WASM jezgro i srpski (ćirilični) jezički podaci
```

### Pravljenje paketa
```
python build.py
```
Pravi `dist/tisina-tamo-chrome-<verzija>.zip` i `dist/tisina-tamo-firefox-<verzija>.zip`.

### Učitavanje za razvoj
- **Firefox:** `about:debugging` → This Firefox → Load Temporary Add-on → `manifest.json` iz korena.
- **Chrome/Edge:** raspakovati Chrome paket, pa `chrome://extensions` → Developer mode → Load unpacked.

### Razlike između pregledača
- Chrome nema DOM u service worker-u, pa se OCR izvršava u offscreen dokumentu (`src/ocr/offscreen.html`).
- Firefox nema offscreen API, pa se OCR izvršava u pozadinskoj stranici (`src/ocr/ocr.js` kao pozadinska skripta).

### Detalji prepoznavanja
- OCR je Tesseract.js sa srpskim (ćiriličnim) modelom, ograničen samo na slova ćirilice, da ne bi
  mešao slična latinična slova.
- Poređenje ignoriše razmake i interpunkciju, prevodi ćirilicu u latinicu pre upoređivanja, toleriše
  oko 20% grešaka u frazama od 5+ slova i dodatno dozvoljava zadati broj pogrešnih slova (Hamingovo
  rastojanje), uključujući pogrešno pročitan razmak.
