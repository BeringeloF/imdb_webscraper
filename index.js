const puppeteer = require('puppeteer');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const pool = require('./db');
const { exec } = require('child_process');
const http = require('http');
const https = require('https');

const httpAgent = new http.Agent({ maxSockets: 50 });
const httpsAgent = new https.Agent({ maxSockets: 50 });

const axiosInstance = axios.create({
  httpAgent,
  httpsAgent,
});

axios.defaults.timeout = 30000; // Exemplo: 60 segundos

const movieBaseUrl =
  'https://www.imdb.com/search/title/?title_type=feature,tv_movie,video';
const serieBaseUrl =
  'https://www.imdb.com/search/title/?title_type=tv_series,tv_miniseries';

const ips = [];

const cods = ['us', 'ca', 'gb', 'nl', 'fr', 'de', 'ch', 'no'];
const wait = (sec) =>
  new Promise((resolve) => {
    setTimeout(resolve, 1000 * sec);
  });
let isChangingIp = false;

async function execute(comand) {
  isChangingIp = true;

  exec(comand, (error, stdout, stderr) => {
    if (error) {
      console.error(`Erro ao executar o script: ${error.message}`);
      return;
    }
    if (stderr) {
      console.error(`Erro no script: ${stderr}`);
      return;
    }
  });
  await wait(7);
  const res = await axios.get('https://api.ipify.org?format=json');
  console.log(
    'Mudando para o ip' + ' ' + res.data.ip,
    ' do pais ' + comand.slice(-2)
  );
  isChangingIp = false;
  return res.data.ip;
}

async function changeIp(caller) {
  console.log('CHANGE IP FOI CHAMADO pelo ', caller);
  let cod = 'us';

  const comand = `./alternar_ip_windscribe.sh ${cod}`;
  if (
    (ips.length > 0 && Date.now() - ips.at(-1).date < 25000) ||
    isChangingIp
  ) {
    const str = `ip:${
      ips.at(-1)?.ip
    } do pais ${cod} foi mudado a muito pouco tempo ou esta sendo mudado agora
      teste se o isChangingIp
     ${isChangingIp} `;

    console.log(str);

    return;
  }
  // Executar o script
  let ip = await execute(comand);

  if (ips.some((obj) => obj.ip === ip && Date.now() - obj.date < 500000)) {
    const lastIpCode = ips.at(-1).cod;
    const newIpCode = cods[cods.indexOf(lastIpCode) + 1] || 'ca';
    ip = await execute(comand.slice(0, -2) + newIpCode);
  }
  ips.push({ ip, cod, date: Date.now() });
}

async function getHtml(url, doChangeIp = false, retries = 3) {
  let errStatus;
  while (retries > 0) {
    try {
      if (doChangeIp) {
        await changeIp('getHtml');
      }

      const res = await axiosInstance({
        method: 'GET',
        url,
        headers: {
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
        },
      });

      console.log('STATUSCODE:', res.status);
      return [null, res.data];
    } catch (err) {
      console.error('Erro na requisição:', err.code);
      retries -= 1;

      if (retries === 0) {
        fs.writeFile(
          `./logs/log_error_on_fn_get_html-${new Date().toISOString()}.json`,
          JSON.stringify({ errorMessage: err.message, errorStack: err.stack }),
          (erro) => {
            if (erro) {
              console.error('Erro ao escrever o arquivo:', erro);
            } else {
              console.log('log criado com sucesso!');
            }
          }
        );
      }

      if (err.code === 'ECONNRESET') {
        doChangeIp = false;
        console.log('Tentando novamente...');
      } else {
        errStatus = err.status;
        break;
      }
    }
  }
  return [errStatus, null];
}

async function getImdbData(url) {
  try {
    let [erroStatus, html] = await getHtml(url);
    if (erroStatus === 503) {
      [erroStatus, html] = await getHtml(url, true);
    }
    const start = Date.now();
    if (typeof html !== 'string') {
      console.log(html);
      console.log(url);
      return [null, url];
    }
    const $ = cheerio.load(html);
    const name = $('.hero__primary-text').text();
    //video page document.querySelector('[data-testid="video-player-slate-overlay"]').href
    // video document.querySelector('.jw-video.jw-reset')
    //
    const img = $(
      '.ipc-media.ipc-media--poster-27x40.ipc-image-media-ratio--poster-27x40.ipc-media--media-radius.ipc-media--baseAlt.ipc-media--poster-l.ipc-poster__poster-image.ipc-media__img img'
    ).attr('src');

    let originalTitle = $('.sc-ec65ba05-1.fUCCIx').text();
    originalTitle = originalTitle.slice(originalTitle.indexOf(':') + 2);
    let json = $('#__NEXT_DATA__').text();

    json = await JSON.parse(json);

    const escritores =
      json.props.pageProps.mainColumnData.writers[0]?.credits.map((el) => [
        el.name.nameText.text,
        el.name.id,
      ]);

    const atores = json.props.pageProps.mainColumnData.cast.edges.map((el) => [
      el.node.name.nameText.text,
      el.node.name.id,
    ]);

    const diretores =
      json.props.pageProps.mainColumnData.directors[0]?.credits.map((el) => [
        el.name.nameText.text,
        el.name.id,
      ]);

    const criadores =
      json.props.pageProps.mainColumnData.creators[0]?.credits.map((el) => [
        el.name.nameText.text,
        el.name.id,
      ]);

    if (!json.props.pageProps.aboveTheFoldData.titleType.isSeries) {
      const movie = {
        title: name,
        description:
          json.props.pageProps.aboveTheFoldData.plot?.plotText?.plainText,
        posterUrl: img,
        originalTitle,
        imdb_url: url,
        userScore:
          json.props.pageProps.aboveTheFoldData.ratingsSummary?.aggregateRating,
        voteCount:
          json.props.pageProps.aboveTheFoldData.ratingsSummary?.voteCount,
        releaseYear: json.props.pageProps.aboveTheFoldData?.releaseYear?.year,
        genres: json.props.pageProps.aboveTheFoldData.genres.genres.map(
          (el) => el.text
        ),
        runtimeMin: Math.round(
          json.props.pageProps.aboveTheFoldData?.runtime?.seconds / 60
        ),
        budgetUsd:
          json.props.pageProps.mainColumnData.productionBudget?.budget.amount,
        revenue:
          json.props.pageProps.mainColumnData.worldwideGross?.total.amount,
        ageRating: json.props.pageProps.aboveTheFoldData.certificate?.rating,
        diretores,
        escritores,
        atores,
        criadores,
      };

      const end = Date.now();
      console.log('scrap feito em secs: ', (end - start) / 1000);
      return movie;
    } else {
      const serie = {
        serie: true,
        title: name,
        description:
          json.props.pageProps.aboveTheFoldData.plot?.plotText?.plainText,
        posterUrl: img,
        originalTitle,
        imdb_url: url,
        userScore:
          json.props.pageProps.aboveTheFoldData.ratingsSummary?.aggregateRating,
        voteCount:
          json.props.pageProps.aboveTheFoldData.ratingsSummary?.voteCount,
        releaseYear: json.props.pageProps.aboveTheFoldData?.releaseYear?.year,
        genres: json.props.pageProps.aboveTheFoldData.genres.genres.map(
          (el) => el.text
        ),
        runtimeMin: Math.round(
          json.props.pageProps.aboveTheFoldData?.runtime?.seconds / 60
        ),
        ageRating: json.props.pageProps.aboveTheFoldData.certificate?.rating,
        seasons: json.props.pageProps.mainColumnData.episodes?.seasons.length,
        episodes: json.props.pageProps.mainColumnData.episodes?.episodes?.total,
        escritores,
        atores,
        criadores,
      };

      const end = Date.now();
      console.log('scrap feito em secs: ', (end - start) / 1000);
      return serie;
    }
  } catch (error) {
    console.log('error: ', error);
    fs.writeFile(
      `./logs/log_error_on_fn_get_imdb_data-${new Date().toISOString()}.json`,
      JSON.stringify({
        errorMessage: error.message,
        showUrl: url,
        errorStack: error.stack,
      }),
      (err) => {
        if (err) {
          console.error('Erro ao escrever o arquivo:', err);
        } else {
          console.log('log criado com sucesso!');
        }
      }
    );
  }
}

const url = 'https://www.imdb.com/title/tt0861739/';

const action = {
  query: '&genres=action',
  interval: 6,
};
const drama = {
  query: '&genres=drama',
  interval: 2,
};
const aventure = {
  query: 'genres=adventure',
  interval: 12,
};

const documentary = {
  query: '&genres=documentary',
  interval: 2,
};

const comedy = {
  query: '&genres=comedy',
  interval: 3,
};
const terror = {
  query: '&genres=horror',
  interval: 6,
};

const romance = {
  query: '&genres=romance',
  interval: 6,
};

const suspense = {
  query: '&genres=thriller',
  interval: 6,
};

const animation = {
  query: '&genres=animation',
  interval: 12,
};

async function getEachShowUrl(url) {
  const browser = await puppeteer.launch({ headless: true }); // headless: false para ver o navegador
  try {
    const page = await browser.newPage();

    const userAgent =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36';
    await page.setUserAgent(userAgent);

    await page.goto(url);

    await page.waitForSelector(
      '.ipc-btn.ipc-btn--single-padding.ipc-btn--center-align-content.ipc-btn--default-height.ipc-btn--core-base.ipc-btn--theme-base.ipc-btn--button-radius.ipc-btn--on-accent2.ipc-text-button.ipc-see-more__button'
    );

    const total = +(await page.$eval('.sc-13add9d7-3.fwjHEn', (el) =>
      el.textContent.split(' de ')[1].replace('.', '')
    ));

    console.log(url);
    console.log(total, 'total');

    await page.evaluate(async () => {
      const wait = () =>
        new Promise((resolve) => {
          setTimeout(resolve, 1000);
        });
      const selector = `.ipc-btn.ipc-btn--single-padding.ipc-btn--center-align-content.ipc-btn--default-height.ipc-btn--core-base.ipc-btn--theme-base.ipc-btn--button-radius.ipc-btn--on-accent2.ipc-text-button.ipc-see-more__button`;
      while (document.querySelector(selector)) {
        document.querySelector(selector).click();
        await wait();
      }
    });

    const urls = await page.evaluate(() => {
      return [...document.querySelectorAll('.ipc-title-link-wrapper')].map(
        (el) => el.href.split('?')[0]
      );
    });
    browser.close();
    return urls;
  } catch (error) {
    console.log('erororroro', error);
    fs.writeFile(
      `./logs/log_error_on_fn_get_each_url-${new Date().toISOString()}.json`,
      JSON.stringify({
        errorMessage: error.message,
        showUrl: url,
        errorStack: error.stack,
      }),
      (err) => {
        if (err) {
          console.error('Erro ao escrever o arquivo:', err);
        } else {
          console.log('log criado com sucesso!');
        }
      }
    );
    if (n > 1) return [];
    console.log('CHAMANDO...MUDANÇA DE IP');
    await changeIp('getAllData');
    browser.close();
    return await getEachShowUrl(url, n || 1 + 1);
  }
}

// url para todos os filmes title_type=feature significa filmes https://www.imdb.com/search/title/?title_type=feature
//url para series ?title_type=tv_series,tv_miniseries

async function getAllData(url) {
  try {
    const urls = Array.isArray(url) ? url : await getEachShowUrl(url);
    return await Promise.all(
      urls.map(async (url) => {
        return await getImdbData(url);
      })
    );
  } catch (error) {
    console.log(error);
  }
}

function lastDay(year, month) {
  const date = new Date(year, month, 0);
  return date.getDate();
}

function getDates(interval, yearStart, yearEnd) {
  const dates = [];

  for (let i = yearStart; i <= yearEnd; i++) {
    let month = '1';

    for (let j = +month; j <= 12 / interval; j++) {
      const secMonth = +month + (interval - 1) + '';
      dates.push(
        `${i}-${month.length === 1 ? '0' + month : month}-${'01'},${i}-${
          secMonth.length === 1 ? '0' + secMonth : secMonth
        }-${lastDay(i, secMonth)}`
      );
      month = +month + interval + '';
    }
  }

  return dates;
}
//https://www.imdb.com/search/title/?title_type=feature
function getSearchUrls(queryObj, baseUrl, yearStart, yearEnd) {
  const dates = getDates(queryObj.interval, yearStart, yearEnd);
  const urls = dates.map(
    (date) => `${baseUrl}${queryObj.query}&release_date=${date}`
  );
  return urls;
}

async function runScript(queryObj, yearStart, yearEnd, baseUrl) {
  const searchUrls = getSearchUrls(queryObj, baseUrl, yearStart, yearEnd);
  const start = Date.now();
  const genre = queryObj.query.split('=')[1];
  const type = baseUrl.includes('feature') ? 'movie' : 'serie';
  const totalShows = [];
  try {
    for (const url of searchUrls) {
      totalShows.push(await scrapAndSaveData(url, genre, type));
    }

    console.log(
      'quantidade de filmes/series analizados: ',
      totalShows.reduce((acc, val) => {
        acc += val;
        return acc;
      }, 0)
    );
    console.log(
      'tempo de funcionamento do script em secs: ',
      (Date.now() - start) / 1000
    );
  } catch (err) {
    console.log(err);
  }
}

async function scrapAndSaveData(url, genre, type) {
  let dataAndError = await getAllData(url);
  const data = [];
  const error = [];

  dataAndError.forEach((el) => {
    if (Array.isArray(el)) {
      error.push(el);
    } else {
      data.push(el);
    }
  });

  console.log('dados obtidos com sucesso: ' + data.length);
  console.log('erro ao obter dados: ', error.length);

  const dateInterval = url.split('=').at(-1).split(',').join('_');

  fs.writeFile(
    `./data/data-${type}-${genre}-${dateInterval}.json`,
    JSON.stringify(data),
    (err) => {
      if (err) {
        console.error('Erro ao escrever o arquivo:', err);
      } else {
        console.log('Dados salvos com sucesso!');
      }
    }
  );

  if (error.length > 0) {
    fs.writeFile(
      `./retry/retry-${type}-${genre}-${dateInterval}.json`,
      JSON.stringify(error),
      (err) => {
        if (err) {
          console.error('Erro ao escrever o arquivo:', err);
        } else {
          console.log('Dados salvos com sucesso!');
        }
      }
    );
  }
  return data.length;
}

async function retry() {
  const files = fs.readdirSync('./retry');

  for (let file of files) {
    const retryUrls = JSON.parse(
      fs.readFileSync('./retry/' + file, 'utf8')
    ).map((el) => el[1]);

    let dataAndError = await getAllData(retryUrls);

    const adcionalData = [];
    const error = [];

    dataAndError.forEach((el) => {
      if (Array.isArray(el)) {
        error.push(el);
      } else {
        adcionalData.push(el);
      }
    });

    console.log('dados obtidos com sucesso: ' + adcionalData.length);
    console.log('erro ao obter dados: ', error.length);

    const fileName = 'data' + file.slice(5);

    const data = [
      ...JSON.parse(fs.readFileSync('./data/' + fileName, 'utf8')),
      ...adcionalData,
    ];

    fs.writeFile(`./data/${fileName}`, JSON.stringify(data), (err) => {
      if (err) {
        console.error('Erro ao escrever o arquivo:', err);
      } else {
        console.log('Dados salvos com sucesso!');
      }
    });

    if (error.length === 0) {
      fs.unlink('./retry/' + file, (err) => {
        if (err) {
          console.error('Erro ao deletar o arquivo:', err);
        } else {
          console.log('Arquivo deletado!');
        }
      });
      return;
    }
    fs.writeFile(`./retry/${file}`, JSON.stringify(error), (err) => {
      if (err) {
        console.error('Erro ao escrever o arquivo:', err);
      } else {
        console.log('url a serem repitidas foram salvas com sucesso!');
      }
    });
  }
}

//retry();

runScript(action, 2010, 2012, serieBaseUrl);

//01-03 04-06 07-09 10-12

//https://www.imdb.com/tr/?ref_=sr-seemore&pt=advsearch&spt=title&ht=actionOnly&pageAction=seemore
