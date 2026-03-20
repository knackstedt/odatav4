import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { type AfterViewInit, Component, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MonacoEditorComponent } from '@dotglitch/ngx-common/monaco-editor';
import { AngularSplitModule } from 'angular-split';
import { NgScrollbarModule } from 'ngx-scrollbar';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { PanelModule } from 'primeng/panel';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SelectModule } from 'primeng/select';
import { Tab, TabList, TabPanel, TabPanels, Tabs } from 'primeng/tabs';
import { createQuery } from '../../../src/parser/main';
import { renderQuery } from '../../../src/parser/query-renderer';
import { SQLLang } from '../../../src/parser/visitors/types';
import { formatSurrealQL } from '../../../src/util/sql-formatter';
import * as ODataQueryLanguage from './grammars/odata-query';
import * as SurrealQLLanguage from './grammars/surrealql';

interface QueryParam {
  key: string;
  value: string;
  label: string;
  placeholder: string;
}

interface QueryResult {
  generatedQuery: string;
  parameters?: Record<string, any>;
  responseData?: any;
  error?: string;
}

interface DialectOption {
  label: string;
  value: SQLLang;
}

declare const monaco: any;

@Component({
    selector: 'app-root',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        AngularSplitModule,
        NgScrollbarModule,
        ButtonModule,
        InputTextModule,
        SelectModule,
        CardModule,
        PanelModule,
        MessageModule,
        ProgressSpinnerModule,
        MonacoEditorComponent,
        Tabs,
        TabList,
        Tab,
        TabPanels,
        TabPanel,
    ],
    templateUrl: './app.component.html',
    styleUrl: './app.component.scss',
})
export class AppComponent implements AfterViewInit {
  Object = Object;

    readonly ODataQueryLanguage = ODataQueryLanguage;
    readonly SurrealQLLanguage = SurrealQLLanguage;

  apiEndpoint = signal<string>('http://localhost:3000/api/odata/users');
  tableName = signal<string>('users');
  selectedDialect = signal<SQLLang>(SQLLang.SurrealDB);

  queryParams = signal<QueryParam[]>([
    { key: '$filter', value: 'age gt 25 and name eq \'John\'', label: '$filter', placeholder: 'age gt 25 and name eq \'John\'' },
    { key: '$select', value: 'name,email,age', label: '$select', placeholder: 'name,email,age' },
    { key: '$orderby', value: 'name desc', label: '$orderby', placeholder: 'name desc' },
    { key: '$top', value: '10', label: '$top', placeholder: '10' },
    { key: '$skip', value: '', label: '$skip', placeholder: '0' },
  ]);

  dialects: DialectOption[] = [
    { label: 'SurrealDB', value: SQLLang.SurrealDB },
    { label: 'PostgreSQL', value: SQLLang.PostgreSql },
    { label: 'MS SQL', value: SQLLang.MsSql },
    { label: 'MySQL', value: SQLLang.MySql },
    { label: 'Oracle', value: SQLLang.Oracle },
  ];

  loading = signal<boolean>(false);
  queryResult = signal<QueryResult | null>(null);
  error = signal<string | null>(null);
  activeTab = signal<number>(0);
  substituteParams = signal<boolean>(false);
  simplifyQuery = signal<boolean>(false);

  private editors: Map<string, any> = new Map();
  private monacoLoaded = false;
  private lastParsedUrl = '';

  constructor(private http: HttpClient) {
    effect(() => {
      const params = this.queryParams();
      const dialect = this.selectedDialect();
      const substitute = this.substituteParams();
      const simplify = this.simplifyQuery();
      this.generateQueryClientSide();
    });

    effect(() => {
      const endpoint = this.apiEndpoint();
      // Only parse if the URL has actually changed
      if (endpoint !== this.lastParsedUrl) {
        this.lastParsedUrl = endpoint;
        this.parseUrlAndPopulateParams(endpoint);
      }
    });
  }

  ngAfterViewInit() {
    this.initMonaco();
  }

  private initMonaco() {
    if (typeof monaco === 'undefined') {
      setTimeout(() => this.initMonaco(), 100);
      return;
    }

    this.monacoLoaded = true;
    this.queryParams().forEach(param => {
      this.createEditor(param.key);
    });
  }

  private createEditor(key: string) {
    if (!this.monacoLoaded) return;

    const container = document.getElementById(`editor-${key}`);
    if (!container || this.editors.has(key)) return;

    const param = this.queryParams().find(p => p.key === key);
    if (!param) return;

    const editor = monaco.editor.create(container, {
      value: param.value,
      language: 'plaintext',
      theme: 'vs-dark',
      minimap: { enabled: false },
      lineNumbers: 'off',
      scrollBeyondLastLine: false,
      automaticLayout: true,
      fontSize: 13,
      fontFamily: 'var(--skp-font-mono)',
      padding: { top: 8, bottom: 8 },
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      overviewRulerBorder: false,
      scrollbar: {
        vertical: 'hidden',
        horizontal: 'hidden'
      }
    });

    editor.onDidChangeModelContent(() => {
      const newValue = editor.getValue();
      this.updateQueryParam(key, newValue);
    });

    this.editors.set(key, editor);
  }

  updateQueryParam(key: string, value: string) {
    const params = this.queryParams();
    const index = params.findIndex(p => p.key === key);
    if (index !== -1) {
      params[index].value = value;
      this.queryParams.set([...params]);
    }
  }

  private isParsingUrl = false;

  private parseUrlAndPopulateParams(urlString: string) {
    if (this.isParsingUrl) return;

    this.isParsingUrl = true;

    try {
      let searchParams: URLSearchParams;
      let pathname: string | null = null;
      let origin: string | null = null;

      // Case 1: Try parsing as full URL (http://localhost:3000/api/odata/users?$filter=...)
      try {
        const url = new URL(urlString);
        searchParams = url.searchParams;
        pathname = url.pathname;
        origin = url.origin;
      } catch {
        // Case 2: Check if it's a path with query params (/api/odata/users?$filter=...)
        if (urlString.includes('/') && urlString.includes('?')) {
          const [path, query] = urlString.split('?');
          pathname = path;
          searchParams = new URLSearchParams(query);
        }
        // Case 3: Check if it's just query parameters ($filter=...&$select=...)
        else if (urlString.includes('=') && (urlString.startsWith('$') || urlString.includes('&$'))) {
          searchParams = new URLSearchParams(urlString);
        }
        // Case 4: Path only without query params
        else if (urlString.includes('/')) {
          pathname = urlString;
          searchParams = new URLSearchParams();
        }
        else {
          // Not a recognized format
          this.isParsingUrl = false;
          return;
        }
      }

      // Extract table name from pathname if available
      if (pathname) {
        const pathSegments = pathname.split('/').filter(s => s);
        if (pathSegments.length > 0) {
          const lastSegment = pathSegments[pathSegments.length - 1];
          this.tableName.set(lastSegment);
        }

        // Update endpoint to base URL if we have origin and pathname
        if (origin) {
          const baseEndpoint = `${origin}${pathname}`;
          if (baseEndpoint !== urlString) {
            this.lastParsedUrl = baseEndpoint;
            this.apiEndpoint.set(baseEndpoint);
          }
        }
      }

      // Parse and populate query parameters
      const params = this.queryParams();
      let hasParams = false;

      params.forEach((param, index) => {
        const value = searchParams.get(param.key);
        if (value !== null) {
          hasParams = true;
          params[index].value = decodeURIComponent(value);

          // Update Monaco editor if it exists
          const editor = this.editors.get(param.key);
          if (editor) {
            editor.setValue(params[index].value);
          }
        }
      });

      if (hasParams) {
        this.queryParams.set([...params]);
      }

    } catch (e) {
      // Parsing failed, ignore
    } finally {
      this.isParsingUrl = false;
    }
  }

  generateQueryClientSide() {
    try {
      const queryString = this.buildODataQueryString();
      if (!queryString) {
        this.queryResult.set(null);
        return;
      }

      const visitor = createQuery(queryString, {}, this.selectedDialect());
      const rendered = renderQuery(
        {
          select: visitor.select,
          where: visitor.where,
          orderby: visitor.orderby,
          limit: visitor.limit,
          skip: visitor.skip,
          parameters: visitor.parameters
        },
        this.tableName()
      );

      const formatted = formatSurrealQL(rendered.entriesQuery.toString(), {
        substituteParams: this.substituteParams(),
        simplifyQuery: this.simplifyQuery(),
        parameters: rendered.parameters
      });

      this.queryResult.set({
        generatedQuery: formatted,
        parameters: rendered.parameters,
        error: undefined
      });
      this.error.set(null);
    } catch (err: any) {
      this.error.set(err.message || 'Failed to generate query');
      this.queryResult.set({
        generatedQuery: 'Error generating query',
        error: err.message
      });
    }
  }

  private buildODataQueryString(): string {
    const parts = this.queryParams()
      .filter(p => p.value.trim())
      .map(p => `${p.key}=${encodeURIComponent(p.value)}`);
    return parts.join('&');
  }

  async executeQuery() {
    this.loading.set(true);
    this.error.set(null);

    try {
      const queryString = this.buildODataQueryString();
      const url = `${this.apiEndpoint()}${queryString ? '?' + queryString : ''}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      const current = this.queryResult();
      this.queryResult.set({
        ...current!,
        responseData: data
      });

      this.activeTab.set(1);
    } catch (err: any) {
      this.error.set(err.message || 'Failed to execute query');
    } finally {
      this.loading.set(false);
    }
  }

  getParamIcon(key: string): string {
    const icons: { [key: string]: string } = {
      '$filter': 'pi pi-filter',
      '$select': 'pi pi-list',
      '$orderby': 'pi pi-sort-alt',
      '$top': 'pi pi-arrow-up',
      '$skip': 'pi pi-arrow-down',
      '$expand': 'pi pi-sitemap',
      '$count': 'pi pi-hashtag'
    };
    return icons[key] || 'pi pi-tag';
  }

  formatJson(obj: any): string {
    return JSON.stringify(obj, null, 2);
  }

  getDialectLabel(): string {
    return this.dialects.find(d => d.value === this.selectedDialect())?.label || '';
  }

  async pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        this.apiEndpoint.set(text.trim());
      }
    } catch (err) {
      console.error('Failed to read clipboard:', err);
      this.error.set('Failed to read from clipboard. Please grant clipboard permissions.');
    }
  }

  async copyQueryToClipboard() {
    try {
      const query = this.queryResult()?.generatedQuery;
      if (query) {
        await navigator.clipboard.writeText(query);
      }
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      this.error.set('Failed to copy to clipboard. Please grant clipboard permissions.');
    }
  }
}
