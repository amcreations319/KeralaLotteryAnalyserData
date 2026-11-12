const HEADER_PATTERN = /in\s+([A-Z -]+?)\s+LOTTERY\s+NO\.([A-Z]+-\d+).*?held on:-\s*(\d{2}\/\d{2}\/\d{4})/is;
const PRIZE_PATTERN = /^(Cons Prize|\d+(?:st|nd|rd|th) Prize)\s*-?\s*Rs\s*:?\s*([0-9]+)\/?-?/i;
const LOCATION_PATTERN = /([A-Z]{2})\s+(\d{4,6})\s+\(([A-Z\s.-]+)\)/g;
const SERIES_PATTERN = /([A-Z]{2})\s+(\d{6})/g;
const ENDING_NUMBER_PATTERN = /\b\d{4}\b/g;
const HAS_SERIES_PATTERN = /[A-Z]{2}\s+\d{6}/;
const HAS_LOCATION_PATTERN = /\([^)]+\)/;
const PAGE_FOOTER_PATTERN = /^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}\s+Modernization & IT Software Division/i;
const PAGE_FOOTER_BLOCK_PATTERN = /^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}\s+Modernization & IT Software Division.*?Page\s+\d+\s*$/gim;
const TRAILER_START_PATTERN = /^The prize winners are advised to verify the winning numbers/i;
const NEXT_DRAW_DATE_PATTERN = /Next\s+[A-Z\s]+?\s+Draw\s+will\s+be\s+held\s+on\s+(\d{2}\/\d{2}\/\d{4})\s+at/i;
const PRIZE_BLOCK_PATTERN = /(Cons Prize|\d+(?:st|nd|rd|th) Prize)\s*-?\s*Rs\s*:?\s*([0-9]+)\/?-?\s*([\s\S]*?)(?=(?:Cons Prize|\d+(?:st|nd|rd|th) Prize)\s*-?\s*Rs\s*:?\s*[0-9]+\/?-?|The prize winners are advised to verify the winning numbers|Next\s+[A-Z\s]+?\s+Draw\s+will\s+be\s+held\s+on|$)/gi;

const props = PropertiesService.getScriptProperties();
const drawSerial = Number(props.getProperty("DRAW_SERIAL") || 1);
const disableWrite = JSON.parse(props.getProperty("DISABLE_WRITE") || "true");
const passKey = props.getProperty("PASSKEY");
const url = `https://result.keralalotteries.com/viewlotisresult.php?drawserial=${drawSerial}`;

function doGet(e) {
  const { requestType, secretKey } = e.parameter;

  if (requestType === "runExport" && secretKey === passKey.toString()) {
    return exportLotteryResultToGitHub();
  } else if (requestType === "authenticate" && secretKey === passKey.toString()) {
    return ContentService.createTextOutput("Success").setMimeType(ContentService.MimeType.TEXT);
  } else if (requestType === "jsonExport" && secretKey === passKey.toString()) {
    return exportSingleSheetToJSON();
  } else {
    return ContentService.createTextOutput("Wrong Passkey").setMimeType(ContentService.MimeType.TEXT);
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const pdfBlob = Utilities.newBlob(Utilities.base64Decode(data.pdfBase64), MimeType.PDF, "Lottery.pdf");
    
    // Call your existing processing logic using this blob
    return processLotteryPdf(pdfBlob, data.url);
  } catch (err) {
    Logger.log("Error in doPost: " + err);
    return ContentService.createTextOutput("Error: " + err).setMimeType(ContentService.MimeType.TEXT);
  }
}

function exportLotteryResultToGitHub() {
  let pdf = null;
  let doc = null;

  try {
    const response = UrlFetchApp.fetch(url);

    if (response.getResponseCode() !== 200)
      ContentService.createTextOutput("Results not yet published for " + url).setMimeType(ContentService.MimeType.TEXT);

    pdf = DriveApp.createFile(response.getBlob().setName("Lottery.pdf"));
    doc = Drive.Files.copy({ mimeType: MimeType.GOOGLE_DOCS }, pdf.getId());
    const text = DocumentApp.openById(doc.id).getBody().getText();

    if (!text || text.length < 50)
      ContentService.createTextOutput("Total text length is below 50 for " + url).setMimeType(ContentService.MimeType.TEXT);;

    const parsedResult = parseLotteryResult(text);
    const rows = toExcelRows(parsedResult);

    if (!disableWrite) {
      saveLotteryResults(rows);
      props.setProperty("DRAW_SERIAL", String(drawSerial + 1));
    }

    exportSingleSheetToJSON();

    return ContentService.createTextOutput("Successfully uploaded data for " + url).setMimeType(ContentService.MimeType.TEXT);

  } catch (err) {
    Logger.log(err);
    return ContentService.createTextOutput("Error: " + err).setMimeType(ContentService.MimeType.TEXT);
  } finally {
    try {
      if (pdf)
        pdf.setTrashed(true);
      if (doc?.id)
        DriveApp.getFileById(doc.id).setTrashed(true);
    } catch (cleanupErr) {
      Logger.log(cleanupErr);
      return ContentService.createTextOutput("Clean up error: " + cleanupErr).setMimeType(ContentService.MimeType.TEXT);
    }
  }
}

function parseLotteryResult(text) {

  const result = {
    lotteryName: null,
    drawNumber: null,
    drawDate: null,
    nextDrawDate: null,
    prizes: []
  };

  const headerMatch = text.match(HEADER_PATTERN);

  if (headerMatch) {
    result.lotteryName = headerMatch[1];
    result.drawNumber = headerMatch[2];
    result.drawDate = headerMatch[3];
  }

  const nextDrawMatch = text.match(NEXT_DRAW_DATE_PATTERN);

  if (nextDrawMatch) {
    result.nextDrawDate = nextDrawMatch[1];
  }

  const normalizedText = text
    .replace(/\r\n?/g, "\n")
    .replace(PAGE_FOOTER_BLOCK_PATTERN, " ")
    .replace(/\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  PRIZE_BLOCK_PATTERN.lastIndex = 0;

  let prizeMatch;
  while ((prizeMatch = PRIZE_BLOCK_PATTERN.exec(normalizedText)) !== null) {
    const currentPrize = {
      prizeRank: prizeMatch[1],
      amount: Number(prizeMatch[2]),
      winners: [],
      winnerKeys: new Set()
    };

    result.prizes.push(currentPrize);
    parseWinnerData(prizeMatch[3].trim(), currentPrize);
  }

  return result;
}

function parseWinnerData(text, prizeObj) {

  let match;
  let foundLocation = false;
  LOCATION_PATTERN.lastIndex = 0;

  while ((match = LOCATION_PATTERN.exec(text)) !== null) {
    foundLocation = true;
    const winnerKey = `${match[1]}:${match[2]}`;

    if (!prizeObj.winnerKeys.has(winnerKey)) {
      prizeObj.winners.push({ series: match[1], number: match[2], location: match[3].trim() });
      prizeObj.winnerKeys.add(winnerKey);
    }
  }

  if (!foundLocation) {
    SERIES_PATTERN.lastIndex = 0;

    while ((match = SERIES_PATTERN.exec(text)) !== null) {
      const winnerKey = `${match[1]}:${match[2]}`;

      if (!prizeObj.winnerKeys.has(winnerKey)) {
        prizeObj.winners.push({ series: match[1], number: match[2] });
        prizeObj.winnerKeys.add(winnerKey);
      }
    }
  }

  if (!HAS_SERIES_PATTERN.test(text) && !HAS_LOCATION_PATTERN.test(text)) {
    const endings = text.match(ENDING_NUMBER_PATTERN);
    if (endings)
      for (const ending of endings)
        prizeObj.winners.push({ endingNumber: ending });
  }
}

function toExcelRows(parsed) {

  const drawDate = formatDate(parsed.drawDate);
  const nextDrawDate = formatDate(parsed.nextDrawDate);

  return parsed.prizes.map(prize => {

    const series = new Set();
    const winningNumbers = new Set();
    const endingNumbers = new Set();
    const locations = new Set();

    for (const winner of prize.winners) {
      if (winner.series)
        series.add(winner.series);

      if (winner.number)
        winningNumbers.add(winner.number);

      if (winner.endingNumber)
        endingNumbers.add(winner.endingNumber);

      if (winner.location)
        locations.add(winner.location);
    }

    return {
      drawDate,
      lottery: parsed.lotteryName,
      drawNo: parsed.drawNumber,
      prizeRank: prize.prizeRank,
      prizeAmount: prize.amount,
      series: [...series].join(","),
      winningNumbers: [...winningNumbers].join(", "),
      endingNumbers: [...endingNumbers].join(", "),
      locations: [...locations].join(", "),
      nextDrawDate,
      url
    };
  });
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const [dd, mm, yyyy] = dateStr.split("/");
  return `${yyyy}/${mm}/${dd}`;
}

function saveLotteryResults(data) {

  if (!data.length) return;

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Results");

  const rows = data.map(r => [
    r.drawDate,
    r.lottery,
    r.drawNo,
    r.prizeRank,
    r.prizeAmount,
    r.locations,
    r.series,
    r.winningNumbers,
    r.endingNumbers,
    r.nextDrawDate,
    r.url
  ]);

  const startRow = sheet.getLastRow() + 1;

  sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
}

function exportSingleSheetToJSON() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data = sheet.getDataRange().getValues();

  if (data.length <= 1) return; // Stop if empty or only headers exist

  const headers = data[0];
  const rows = data.slice(1);

  // Map rows to key-value objects
  const jsonArray = rows.map(row => {
    let rowObj = {};
    headers.forEach((header, index) => {
      if (header) rowObj[header] = row[index];
    });
    return rowObj;
  });

  // Wrap inside object with sheet name as key
  const output = {
    [sheet.getName()]: jsonArray
  };

  const jsonContent = JSON.stringify(output, null, 2);
  const fileName = sheet.getName() + "_export.json";

  // --- GITHUB CONFIGURATION ---
  const GITHUB_TOKEN = "token"; // Replace with your GitHub Fine-grained Token or PAT
  const OWNER = "amcreations319";
  const REPO = "KeralaLotteryAnalyserData";
  const BRANCH = "main";
  const PATH = fileName; // Uploads to root; e.g. "Results_export.json"

  // Base64 encode the JSON payload (required by GitHub API)
  const encodedContent = Utilities.base64Encode(jsonContent, Utilities.Charset.UTF_8);

  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`;

  // Step 1: Check if the file already exists on GitHub to get its SHA (required for updating existing files)
  let existingSha = null;
  const getOptions = {
    method: "get",
    headers: {
      "Authorization": "Bearer " + GITHUB_TOKEN,
      "Accept": "application/vnd.github.v3+json"
    },
    muteHttpExceptions: true
  };

  const checkResponse = UrlFetchApp.fetch(url + "?ref=" + BRANCH, getOptions);

  if (checkResponse.getResponseCode() === 200) {
    const fileInfo = JSON.parse(checkResponse.getContentText());
    existingSha = fileInfo.sha;
  }

  // Step 2: Create payload for GitHub API
  const payload = {
    message: `Automated commit from Google Sheets: Update ${fileName}`,
    content: encodedContent,
    branch: BRANCH
  };

  // Include sha if file already exists
  if (existingSha) {
    payload.sha = existingSha;
  }

  const putOptions = {
    method: "put",
    contentType: "application/json",
    headers: {
      "Authorization": "Bearer " + GITHUB_TOKEN,
      "Accept": "application/vnd.github.v3+json"
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  // Step 3: Push file to GitHub
  const uploadResponse = UrlFetchApp.fetch(url, putOptions);
  const statusCode = uploadResponse.getResponseCode();

  if (statusCode === 200 || statusCode === 201) {
    Logger.log(`Successfully uploaded ${fileName} to GitHub repo: ${OWNER}/${REPO}`);
  } else {
    Logger.log(`Failed to upload to GitHub (${statusCode}): ` + uploadResponse.getContentText());
    return ContentService.createTextOutput(`Failed to upload to GitHub (${statusCode}): ` + uploadResponse.getContentText()).setMimeType(ContentService.MimeType.TEXT);
  }

  // --- Step 4: Purge jsDelivr CDN Cache ---
  const timestamp = new Date().getTime();
  const purgeUrl = `https://purge.jsdelivr.net/gh/${OWNER}/${REPO}@${BRANCH}/${PATH}?t=${timestamp}`;
  try {
    const purgeResponse = UrlFetchApp.fetch(purgeUrl, { method: "get", muteHttpExceptions: true });
    if (purgeResponse.getResponseCode() === 200) {
      Logger.log("jsDelivr cache purged successfully!");
    } else {
      Logger.log("Purge warning: " + purgeResponse.getContentText());
      return ContentService.createTextOutput("Purge warning: " + purgeResponse.getContentText()).setMimeType(ContentService.MimeType.TEXT);
    }
  } catch (e) {
    Logger.log("Failed to send purge request: " + e.toString());
    return ContentService.createTextOutput("Failed to send purge request: " + e.toString()).setMimeType(ContentService.MimeType.TEXT);
  }

  return ContentService.createTextOutput("Successfully exported excell to github").setMimeType(ContentService.MimeType.TEXT);
}
