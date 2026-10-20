# Core Protocol: пакет для публікації

Усе для подачі на Poki (і CrazyGames). Тексти для форм англійською лежать у [`listing.md`](listing.md), медіа в `publish/out/`, архіви збірок у `dist/`.

## Як перезібрати

```sh
npm run package                 # dist/core-protocol-poki.zip, dist/core-protocol-crazygames.zip
node tools/covers/render.mjs    # статичні обкладинки → publish/out/*.png (tools/covers/cover.html)
UI_PORT=5186 node tools/covers/record.mjs 9  # запис геймплею (власний Vite-сервер + dev-хуки) → publish/out/raw/port.webm
tools/covers/videos.sh          # → publish/out/poki-animated-thumbnail-1080x1080.mp4
```

Обкладинки (`cover.html`) показують те, що є тільки в цій грі: ядро в гекс-кристалі з 7 модулів у кольорах тегів (сет Overload із 3 світиться, зв'язок Overload+Firewall зварений як фузія), кільце Pulse, тіла вірусів (капсид, комета з джгутиками, гранований танк, фаг на ніжках, на портретній ще бос) над інфікованою територією; фон глибокий teal, не фіолетовий кіберпанк. Кольори з `src/render/palette.ts`, форми вірусів — порт `enemies()` із `src/render/textures.ts`: якщо там щось зміниться, онови і `cover.html`. Перевір читабельність у ~200 px (зменш PNG).

`record.mjs` сам налаштовує сцену: boot-сектор (бажано Hot Start), Chain/Cryo протоколи в кристалі, god mode, хвиля 20 з босом, додатковий натовп вірусів, по одному Pulse у кожному з двох кліпів, які ріже `videos.sh`, весь текст і рамка кнопки PULSE приховані. Запис потребує ffmpeg від Playwright: якщо `record.mjs` пише «Executable doesn't exist … ffmpeg-1011», один раз запусти `node node_modules/playwright-core/cli.js install ffmpeg` (саме цей CLI, не `npx playwright`, бо той ставить іншу ревізію). Увесь цикл record + videos — близько хвилини.

## Poki

| Що | Файл | Вимога |
|---|---|---|
| Збірка | `dist/core-protocol-poki.zip` (410 KB, 9 файлів, `index.html` у корені) | без зовнішніх запитів, крім SDK (шрифти в збірці) ✅ |
| Статична мініатюра | `publish/out/poki-thumbnail-1080x1080.png` (є і 800×800) | квадрат ≥ 628×628, без тексту і рамок ✅ |
| Анімована мініатюра | `publish/out/poki-animated-thumbnail-1080x1080.mp4` | 1:1 ≥ 1080, ≥ 50 fps, 4–6 с (5 с), без звуку, ≤ 100 MB (3.3 MB), починається зі статичного арту ✅ |

Вимоги, які вже виконано (перевірено фейковим SDK у `npm run ui` і `npm run ui:portal-build`, не на справжньому):
- ✅ `gameLoadingFinished` один раз; `gameplayStart` лише після першого вводу; `gameplayStop` на паузі, оверлеях (вибір протоколу, меню, статистика), смерті й рекламі.
- ✅ `commercialBreak` тільки на RESTART/RETRY (природна перерва); не на першій смерті сесії, і не частіше ніж раз на 180 с (`src/data/ads.json`).
- ✅ Rewarded лише за дією гравця, з позначкою ▶AD; нагорода тільки після повного перегляду; без реклами кнопки ховаються (adblock).
- ✅ Звук вимикається на реальному старті реклами; симуляція стоїть, поки реклама йде.
- ✅ Init зі страхувальним таймаутом 5 с: якщо adblock блокує SDK, гра не зависає.
- ✅ localStorage з try/catch (працює в інкогніто, у пам'яті, якщо сховище заблоковане).
- ✅ Немає прокрутки сторінки (пробіл/стрілки/колесо), контекстне меню вимкнене.
- ✅ Обидві орієнтації мають власний макет; англійська; фіксований крок симуляції 30 Гц.

Процес (Poki for Developers):
1. Завантаж `dist/core-protocol-poki.zip`, пройди **Poki Inspector** (inspector.poki.dev): лог подій SDK, QA-чеклісти, час завантаження, телефон через QR.
2. Playtest-записи → **Player Fit Test** (потрібна статична мініатюра; ціль ≥ 3 хв середньої гри) → тест у категоріях → фінальне рев'ю.
3. Для глобального релізу потрібні обидві мініатюри (є).

## CrazyGames (якщо знадобиться)

Обкладинки з назвою вже є: `crazygames-cover-1920x1080.png`, `-800x1200.png`, `-800x800.png`. Збірка: `dist/core-protocol-crazygames.zip`. Прев'ю-відео 15–20 с ще не зроблені (Merge Wall `tools/covers/videos.sh` — зразок; потрібен ще горизонтальний запис). У формі увімкни «Progress Save» (Data Module).

## Що лишається на твоє рішення (ризики)

1. **Ексклюзивність Poki.** Гра зараз публічно доступна на Cloudflare workers.dev (noindex, `tools/deploy-pages.sh`). Poki зазвичай хоче веб-ексклюзив; перед подачею варто вимкнути сторінку (`cd server && npx wrangler delete --name core-protocol`).
2. **Справжній SDK не перевірявся.** Усі перевірки — на фейковому SDK. Inspector — перша справжня перевірка.
3. **Кнопки rewarded на екрані смерті** (REVIVE ▶AD, ×2 BITS ▶AD) стоять над HOME/RETRY і такого ж розміру. Poki радить, щоб звичайна дія була не менш помітною; якщо Inspector/рев'ю зауважить, поміняти ряди місцями — дрібна правка в `src/ui/DeathOverlay.ts`.
4. **Темп прогресії** налаштований на ~80 год до T6 (`reports/progression.md`); casual-гравці застрягають на T4. Для Player Fit Test важливіші перші 3–10 хвилин: перший ран помирає на хвилях 4–6, далі воркшоп.

## Ліцензії

- Phaser 3 — MIT.
- Шрифти Orbitron і Chakra Petch — SIL OFL 1.1, тексти ліцензій у збірці: `fonts/OFL-*.txt`.
- Арт — процедурний неон, власний (обкладинки малює `tools/covers/cover.html` тим самим кодом форм, що й гра).
- Гра не збирає персональних даних і не робить запитів, крім SDK порталу, тож політика конфіденційності не потрібна.
