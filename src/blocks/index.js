/**
 * Slack Block Kit blocks - exports
 */
const { createChartBlocks } = require('./chartBlocks');
const { createTableBlocks, sendTableAsImage } = require('./tableBlocks');
const { createTextBlocks, convertToSlackMrkdwn } = require('./textBlocks');
const { extractStageFiles, removeStageFilePaths, createFileDownloadBlocks } = require('./fileBlocks');

module.exports = {
    createChartBlocks,
    createTableBlocks,
    sendTableAsImage,
    createTextBlocks,
    convertToSlackMrkdwn,
    extractStageFiles,
    removeStageFilePaths,
    createFileDownloadBlocks
};
