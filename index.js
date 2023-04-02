let _now = new Date();
let _chart = null;
let _rawYahoo = null;
let _rawKlseScreener = null;

function $$(selector, context) {
  context = context || document;
  const items = context.querySelectorAll(selector);
  return Array.from(items);
}

function getMean(items, getItemNumber) {
  getItemNumber = getItemNumber || function (x) { return x; };

  const len = items.length;
  let sum = 0;
  let i = len;
  while (i--) {
    sum = sum + getItemNumber(items[i]);
  }

  const mean = sum / len;
  return mean;
}

function toUnixTimetamp(date) {
  return Math.round(date.getTime() / 1000);
}

function createUrl(url, qs) {
  if (!qs) { return url; }

  const params = Object.keys(qs);
  if (params.length) {
    url = url + '?' + params.map(function (p) {
      return p + '=' + encodeURIComponent(qs[p]);
    }).join('&');
  }

  return url;
}

function createUrlCors(method, url, qs) {
  // https://github.com//GeniusGeeek//cors-bypass-proxy
  const urlCors = createUrl('https://cors-proxy.choong.pw', {
    cors: url,
    ...qs,
    method,
  });
  // console.log(urlCors);
  return urlCors;
}

function createUrlYahoo(ticker, from, to) {
  //
  // https://cors-proxy.choong.pw/?cors=https://query1.finance.yahoo.com/v8/finance/chart/4456.KL&method=GET
  // - bypass cors from yahoo to load from frontend
  // - https://cryptocointracker.com/yahoo-finance/yahoo-finance-api
  //

  const urlBase = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`;
  const qs = {};
  qs.interval = '1d';

  qs.period1 = toUnixTimetamp(from);
  qs.period2 = toUnixTimetamp(to);

  qs.events = 'div%7Csplit'

  const url = createUrl(urlBase, qs);
  // console.log(url);
  return { url, urlBase, qs };
}

function parseYahoo(data) {
  const result = data.chart.result[0]
  const timestamp = result.timestamp;
  const quote = result.indicators.quote[0];
  const open = quote.open;
  const low = quote.low;
  const high = quote.high;
  const close = quote.close;
  const volume = quote.volume;

  return [
    // ohlc data
    timestamp.map((t, i) => [t * 1000, open[i], high[i], low[i], close[i]]),
    // volume data
    timestamp.map((t, i) => [t * 1000, volume[i]]),
  ];
}

function createUrlKlseScreener(ticker) {
  // https://www.klsescreener.com/v2/stocks/view/0138
  if (!/\d+.KL/.test(ticker)) {
    return null;
  }

  const stockIndex = ticker.split('.')[0];
  return `https://www.klsescreener.com/v2/stocks/view/${stockIndex}`;
}

function parseKlseScreenerReport(html, from) {
  const doc = $(html);
  const thead = [];
  $('.financial_reports thead tr th', doc).each(function() { thead.push($(this).text()) });
  
  let tbody = [];
  $('.financial_reports tbody tr', doc).each(function() {
    const td = [];
    $(this).find('td').each(function() { td.push($(this).text()) })
    if (td.length === thead.length) {
      tbody.push(td);
    }
  });
  
  const idxQDate = thead.indexOf('Q Date');
  tbody = tbody.filter(data => new Date(data[idxQDate]).getTime() >= from.getTime());

  return [thead, tbody];
}

function clearChart() {
  while (_chart.series.length) {
    _chart.series[0].destroy();
  }
}

function renderData(name, ohlcData, volumeData) {
  //Bollinger bands:
  //https://bl.ocks.org/godds/6550889
  const bandsData = [];
  const period = 20;
  const stdDevs = 2;
  for (let i = period - 1, len = ohlcData.length; i < len; i++) {
    const slice = ohlcData.slice(i + 1 - period, i + 1);
    const mean = getMean(slice, function (d) { return d[4]; });
    const stdDev = Math.sqrt(getMean(slice.map(function (d) {
      return Math.pow(d[4] - mean, 2);
    })));

    bandsData.push([
      ohlcData[i][0],
      mean - (stdDevs * stdDev),
      mean + (stdDevs * stdDev)
    ]);
  }

  //https://www.highcharts.com/component/content/article/2-news/46-gauges-ranges-and-polar-charts-in-beta#ranges
  const bandsSeries = {
    name: 'Bollinger',
    data: bandsData,
    type: 'arearange',
    allowPointSelect: false,
    dataGrouping: { enabled: false },
    tooltip: {
      valueDecimals: 2,
    },
    color: Highcharts.getOptions().colors[6],
    fillOpacity: 0.2,
    opacity: 0.7,
  };
  _chart.addSeries(bandsSeries);

  const volumeSeries = {
    type: 'column',
    name: 'Volume',
    data: volumeData,
    yAxis: 1,
    dataGrouping: { enabled: false },
    color: Highcharts.getOptions().colors[7],
    opacity: 0.5,
  };
  _chart.addSeries(volumeSeries);

  const ohlcSeries = {
    name: name,
    data: ohlcData,
    type: 'candlestick',
    //http://stackoverflow.com/questions/9849806/data-grouping-into-weekly-monthly-by-user
    dataGrouping: { enabled: false },
    tooltip: { valueDecimals: 2 },
  };
  _chart.addSeries(ohlcSeries);
}

function renderReport(name, thead, tbody) {
  const idxEPS = thead.indexOf('EPS');
  const idxQDate = thead.indexOf('Q Date');
  const idxAnnounced = thead.indexOf('Announced');

  const flagData = tbody.map(data => {
    const announcedDate = new Date(data[idxAnnounced]);
    const reportDate = new Date(data[idxQDate]);
    return [
      { x: reportDate.getTime(), title: data[idxEPS] },
      { x: announcedDate.getTime(), title: 'A' }
    ];
  })

  const flagSeries = {
    type: 'flags',
    name: 'Reports',
    data: flagData.flat(),
    shape: 'squarepin'
  }
  _chart.addSeries(flagSeries);
}

function renderIntrinsicValue(growth, peratio, thead, tbody) {
  const SERIES_NAME = 'Intrinsic Value';
  const series = _chart.series.find(o => o.name === SERIES_NAME);
  if (series) {
    series.destroy();
  }
  
  const idxEPS = thead.indexOf('EPS');
  const idxQDate = thead.indexOf('Q Date');
  
  const stepData = [];
  tbody.map(data => {
    const qdate = new Date(data[idxQDate]);
    // Earnings per share (EPS) x (1 + r) x P/E ratio
    const value = (parseFloat(data[idxEPS])/100) * (parseFloat(growth)) * (parseFloat(peratio));

    for (let i = 3; i > 0; i--) {
      const plotDate = new Date(qdate.getTime());
      plotDate.setMonth(qdate.getMonth() + i);
      stepData.push([plotDate.getTime(), value])
    }
  });

  const stepSeries = {
    name: SERIES_NAME,
    lineWidth: 1,
    data: stepData,
    step: true,
    tooltip: { valueDecimals: 2 },
    dataGrouping: { enabled: false },
    color: Highcharts.getOptions().colors[7],
  };
  _chart.addSeries(stepSeries);
}

function fetchAndRenderChart(ticker, to) {
  const from = new Date(to);
  from.setMonth(to.getMonth() - 36);

  const urlChart = createUrlYahoo(ticker, from, to);
  const urlChartCors = createUrlCors('GET', urlChart.urlBase, urlChart.qs);

  $.get(urlChartCors, function (data) {
    // document.write('<pre>'+JSON.stringify(data, null, 2)+'</pre>');
    _rawYahoo = parseYahoo(data);
    renderData(ticker, ..._rawYahoo);
  });

  const urlReport = createUrlKlseScreener(ticker);
  const urlReportCors = createUrlCors('GET', urlReport, {});
  $.get(urlReportCors, function (data) {
    _rawKlseScreener = parseKlseScreenerReport(data, from);
    renderReport(ticker, ..._rawKlseScreener);
  });
}

$(function () {
  $("#symbolForm").submit(event => {
    event.preventDefault();
    clearChart();
    const ticker = document.getElementById("symbol").value;
    fetchAndRenderChart(ticker, new Date(_now));
  });

  $("#intrinsicForm").submit(event => {
    event.preventDefault();
    const growth = document.getElementById("growth").value;
    const peratio = document.getElementById("peratio").value;
    renderIntrinsicValue(growth, peratio, ..._rawKlseScreener)
  });

  _chart = new Highcharts.StockChart({
    chart: {
      renderTo: document.querySelector('#chart1 .chart')
    },
    title: {
      text: 'Intrinsic Value Visualizer'
    },
    rangeSelector: {
      //3 months:
      selected: 1
    },
    yAxis: [{
      gridLineWidth: 0,
      title: { text: 'OHLC' },
    }, {
      visible: false,
      title: { text: 'Volume' },
      top: '60%',
      height: '40%',
    }],
  });
});
