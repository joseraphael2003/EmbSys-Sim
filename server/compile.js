const fs = require('fs');
const Path = require('path');
const application = require('../build-tools/build-application');
const promisify = require('es6-promisify').promisify;
const pinnames = require('../build-tools/generate-pinnames');

module.exports = async function(content, outFolder, boardId) {
    let board = null;
    let allBoards = pinnames.loadBoards();
    if (boardId && String(boardId).trim() !== '' && String(boardId).trim() !== 'default') {
        let bId = String(boardId).trim();
        try {
            board = pinnames.boardById(allBoards, bId);
        }
        catch (e) {
            let validIds = allBoards.boards.map(b => b.board.id).join(', ');
            throw new Error(`Unknown board '${bId}'. Valid boards: ${validIds}`);
        }
    }
    else {
        board = pinnames.boardById(allBoards, 'default');
    }

    let name = 'user_' + Date.now();
    let inputFile = Path.join(outFolder, name + '.cpp');
    let outputFile = Path.join(outFolder, name + '.js');

    await promisify(fs.writeFile)(inputFile, content, 'utf-8');

    try {
        await application.buildFile(inputFile, outputFile, [
            '-O2'
        ], false, board);
    }
    catch (ex) {
        // remove path info
        let basename = Path.resolve(Path.join(__dirname, '..'));
        console.error('buildFile failed', ex);

        if (typeof ex === 'string') {
            while (ex.indexOf(basename) > -1) {
                ex = ex.replace(basename, '');
            }
        }
        throw ex;
    }

    return name;
};

