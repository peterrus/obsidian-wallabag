import WallabagPlugin from 'main';
import NoteTemplate, { DefaultTemplate, PDFTemplate } from 'note/NoteTemplate';
import { Command, Notice, sanitizeHTMLToDom, normalizePath } from 'obsidian';
import { WallabagArticle } from 'wallabag/WallabagAPI';

export default class SyncArticlesCommand implements Command {
  id = 'sync-articles';
  name = 'Sync Wallabag Articles';

  private plugin: WallabagPlugin;
  private syncedFilePath: string;

  constructor(plugin: WallabagPlugin) {
    this.plugin = plugin;
    this.syncedFilePath = `${this.plugin.manifest.dir}/.synced`;
  }

  private async readSynced(): Promise<number[]> {
    const exists = await this.plugin.app.vault.adapter.exists(this.syncedFilePath);
    if (exists) {
      return await this.plugin.app.vault.adapter.read(this.syncedFilePath).then(JSON.parse);
    } else {
      return [];
    }
  }

  private async writeSynced(ids: number[]): Promise<void> {
    return await this.plugin.app.vault.adapter.write(this.syncedFilePath, JSON.stringify(ids));
  }

  private async getUserTemplate(): Promise<NoteTemplate> {
    const template = await this.plugin.app.vault.adapter.read(`${this.plugin.settings.articleTemplate}.md`);
    return new NoteTemplate(template);
  }

  private getFilename(wallabagArticle: WallabagArticle): string {
    const filename = wallabagArticle.title.replaceAll(/[\\,#%&{}/*<>$"@.?]/g, ' ').replaceAll(/[:|]/g, ' ');
    if (this.plugin.settings.idInTitle === 'true') {
      return `${filename}-${wallabagArticle.id}`;
    } else {
      return filename;
    }
  }

  private async createNoteIfNotExists(filename: string, content: string) {
    const exists = await this.plugin.app.vault.adapter.exists(filename);
    if (exists) {
      new Notice(`File ${filename} already exists. Skipping..`);
    } else {
      this.plugin.app.vault.create(filename, content);
    }
  }

  async callback() {
    if (!this.plugin.authenticated) {
      new Notice('Please authenticate with Wallabag first.');
      return;
    }
    const previouslySynced = await this.readSynced();

    const fetchNotice = new Notice('Syncing from Wallabag..');

    const articles = await this.plugin.api.fetchArticles(this.plugin.settings.syncArchived === 'true' ? 1 : 0);
    const newIds = await Promise.all(articles
      .filter((article) => !previouslySynced.contains(article.id))
      .map(async (article) => {
        if (this.plugin.settings.downloadAsPDF !== 'true') {
          const template = this.plugin.settings.articleTemplate === '' ? DefaultTemplate : await this.getUserTemplate();
          const filename = normalizePath(`${this.plugin.settings.folder}/${this.getFilename(article)}.md`);
          const content = template.fill(article, this.plugin.settings.serverUrl, this.plugin.settings.convertHtmlToMarkdown, this.plugin.settings.tagFormat);
          await this.createNoteIfNotExists(filename, content);
        } else {
          const pdfFilename = normalizePath(`${this.plugin.settings.pdfFolder}/${this.getFilename(article)}.pdf`);
          const pdf = await this.plugin.api.exportArticle(article.id);
          await this.plugin.app.vault.adapter.writeBinary(pdfFilename, pdf);
          if (this.plugin.settings.createPDFNote) {
            const template = this.plugin.settings.articleTemplate === '' ? PDFTemplate : await this.getUserTemplate();
            const filename = normalizePath(`${this.plugin.settings.folder}/${this.getFilename(article)}.md`);
            const content = template.fill(article, this.plugin.settings.serverUrl, this.plugin.settings.tagFormat, pdfFilename);
            await this.createNoteIfNotExists(filename, content);
          }
        }
        if (this.plugin.settings.archiveAfterSync === 'true') {
          await this.plugin.api.archiveArticle(article.id);
        }
        return article.id;
      }));
    await this.writeSynced([...newIds, ...previouslySynced]);
    fetchNotice.setMessage(sanitizeHTMLToDom(`Sync from Wallabag is now completed. <br> ${newIds.length} new article(s) has been synced.`));
  }

}
