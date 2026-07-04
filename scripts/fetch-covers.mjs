import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const booksPath = path.join(rootDir, 'data', 'books.json');
const outputDir = path.join(rootDir, 'images', 'books');

const books = JSON.parse(fs.readFileSync(booksPath, 'utf8'));

fs.mkdirSync(outputDir, { recursive: true });

for (const book of books) {
  await downloadCover(book);
}

async function downloadCover(book) {
  const outputFile = path.join(outputDir, `${book.slug}.jpg`);

  if (hasUsableExistingCover(outputFile)) {
    console.log(`skip ${book.slug}`);
    return;
  }

  const imageUrl = await findCoverUrl(book);

  if (!imageUrl) {
    console.warn(`missing ${book.slug}`);
    writeSvgFallback(book, outputFile);
    return;
  }

  try {
    const response = await fetch(tuneGoogleImageUrl(imageUrl), {
      headers: {
        'user-agent': 'Mozilla/5.0 reading-draft-cover-fetcher'
      }
    });

    if (!response.ok) {
      throw new Error(`image HTTP ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(outputFile, buffer);
    console.log(`saved ${book.slug}`);
  } catch (error) {
    console.warn(`failed ${book.slug}: ${error.message}`);
    writeSvgFallback(book, outputFile);
  }
}

function hasUsableExistingCover(filePath) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size <= 1024) {
    return false;
  }

  const firstBytes = fs.readFileSync(filePath, { encoding: 'utf8', flag: 'r' }).slice(0, 80).trimStart();
  return !firstBytes.startsWith('<svg');
}

async function findCoverUrl(book) {
  return await findOpenLibraryCover(book)
    || await findAladinCover(book)
    || await findGoogleBooksCover(book);
}

async function findOpenLibraryCover(book) {
  const url = `https://openlibrary.org/search.json?title=${encodeURIComponent(book.title)}&author=${encodeURIComponent(book.author.split(',')[0])}&limit=8`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return '';
    }

    const payload = await response.json();
    const docs = payload.docs || [];
    const ranked = docs
      .map((doc) => ({ doc, score: scoreOpenLibraryDoc(book, doc) }))
      .filter((entry) => entry.doc.cover_i)
      .sort((a, b) => b.score - a.score);
    const best = ranked[0]?.doc;

    return best?.cover_i ? `https://covers.openlibrary.org/b/id/${best.cover_i}-L.jpg` : '';
  } catch (error) {
    console.warn(`openlibrary failed ${book.slug}: ${error.message}`);
    return '';
  }
}

function scoreOpenLibraryDoc(book, doc) {
  const title = normalize(doc.title);
  const authors = normalize((doc.author_name || []).join(' '));
  const wantedTitle = normalize(book.title);
  const wantedAuthor = normalize(book.author);
  let score = 0;

  if (title === wantedTitle) {
    score += 8;
  }
  if (title.includes(wantedTitle) || wantedTitle.includes(title)) {
    score += 4;
  }
  for (const authorPart of wantedAuthor.split(/\s*,\s*|\s+/).filter(Boolean)) {
    if (authors.includes(authorPart)) {
      score += 1;
    }
  }
  if (String(doc.first_publish_year || '') === String(book.year)) {
    score += 1;
  }

  return score;
}

async function findAladinCover(book) {
  const queries = [
    `${book.title} ${book.publisher}`,
    `${book.title} ${book.author.split(',')[0]}`,
    book.title
  ];

  for (const query of queries) {
    const url = `https://www.aladin.co.kr/search/wsearchresult.aspx?SearchTarget=All&SearchWord=${encodeURIComponent(query)}`;

    try {
      const response = await fetch(url, {
        headers: {
          'user-agent': 'Mozilla/5.0 reading-draft-cover-fetcher'
        }
      });
      if (!response.ok) {
        continue;
      }

      const html = await response.text();
      const matches = [...html.matchAll(/https?:\/\/image\.aladin\.co\.kr\/product\/[^"'\s<>]+\/cover\d+\/[^"'\s<>]+?\.jpg/gi)]
        .map((match) => match[0].replace('/cover150/', '/cover500/').replace('/cover200/', '/cover500/'));

      if (matches.length) {
        return matches[0];
      }
    } catch (error) {
      console.warn(`aladin failed ${book.slug}: ${error.message}`);
    }
  }

  return '';
}

async function findGoogleBooksCover(book) {
  const queries = [
    `intitle:${book.title} inauthor:${book.author.split(',')[0]}`,
    `"${book.title}" ${book.author.split(',')[0]}`,
    book.title
  ];

  for (const query of queries) {
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=10&printType=books`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        continue;
      }

      const payload = await response.json();
      const items = payload.items || [];
      const ranked = items
        .map((item) => ({ item, score: scoreGoogleBooksItem(book, item) }))
        .sort((a, b) => b.score - a.score);

      const best = ranked.find((entry) => entry.score > 0)?.item || items[0];
      const links = best?.volumeInfo?.imageLinks;
      const imageUrl = links?.extraLarge || links?.large || links?.medium || links?.small || links?.thumbnail || links?.smallThumbnail;

      if (imageUrl) {
        return imageUrl;
      }
    } catch (error) {
      console.warn(`query failed ${book.slug}: ${error.message}`);
    }
  }

  return '';
}

function scoreGoogleBooksItem(book, item) {
  const info = item.volumeInfo || {};
  const title = normalize(info.title);
  const subtitle = normalize(info.subtitle);
  const authors = normalize((info.authors || []).join(' '));
  const wantedTitle = normalize(book.title);
  const wantedAuthor = normalize(book.author);
  let score = 0;

  if (title === wantedTitle) {
    score += 8;
  }
  if (title.includes(wantedTitle) || wantedTitle.includes(title) || subtitle.includes(wantedTitle)) {
    score += 4;
  }
  for (const authorPart of wantedAuthor.split(/\s*,\s*|\s+/).filter(Boolean)) {
    if (authors.includes(authorPart)) {
      score += 1;
    }
  }
  if (String(info.publishedDate || '').includes(String(book.year))) {
    score += 1;
  }
  if (normalize(info.publisher || '').includes(normalize(book.publisher))) {
    score += 1;
  }

  return score;
}

function tuneGoogleImageUrl(url) {
  return url
    .replace('http://', 'https://')
    .replace(/zoom=\d/g, 'zoom=0')
    .replace(/&edge=curl/g, '');
}

function normalize(value) {
  return String(value || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function writeSvgFallback(book, outputFile) {
  const title = escapeXml(book.title);
  const author = escapeXml(book.author);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 440">
  <rect width="320" height="440" rx="16" fill="#142033"/>
  <rect x="24" y="24" width="272" height="392" rx="12" fill="#24364d"/>
  <text x="32" y="82" font-size="16" font-family="Arial,sans-serif" font-weight="700" fill="#d7b46a">BOOK DRAFT</text>
  <foreignObject x="32" y="128" width="256" height="190">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font: 700 27px Arial, sans-serif; color: #eef4ff; line-height: 1.15;">${title}</div>
  </foreignObject>
  <foreignObject x="32" y="336" width="256" height="58">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font: 16px Arial, sans-serif; color: #9fb0c3; line-height: 1.25;">${author}</div>
  </foreignObject>
</svg>`;
  fs.writeFileSync(outputFile, Buffer.from(svg));
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
