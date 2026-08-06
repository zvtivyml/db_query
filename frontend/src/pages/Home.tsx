/** Main page with integrated database management and query interface. */

import React, { useState, useEffect } from "react";
import {
  Card,
  Spin,
  Button,
  Input,
  Space,
  Table,
  message,
  Row,
  Col,
  Typography,
  Empty,
  Tabs,
  Modal,
} from "antd";
import {
  PlayCircleOutlined,
  SearchOutlined,
  DatabaseOutlined,
  ReloadOutlined,
  ExclamationCircleOutlined,
  DownloadOutlined,
} from "@ant-design/icons";
import { apiClient } from "../services/api";
import { DatabaseMetadata, TableMetadata } from "../types/metadata";
import { MetadataTree } from "../components/MetadataTree";
import { SqlEditor } from "../components/SqlEditor";
import { DatabaseSidebar } from "../components/DatabaseSidebar";
import { NaturalLanguageInput } from "../components/NaturalLanguageInput";
import { CommandBar } from "../components/CommandBar";
import { AgentInteraction } from "../components/AgentInteraction";
import { executeCommand, isCommand } from "../services/commandParser";

const { Title, Text } = Typography;

interface QueryResult {
  columns: Array<{ name: string; dataType: string }>;
  rows: Array<Record<string, any>>;
  rowCount: number;
  executionTimeMs: number;
  sql: string;
}

export const Home: React.FC = () => {
  const [selectedDatabase, setSelectedDatabase] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<DatabaseMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [sql, setSql] = useState("SELECT * FROM ");
  const [executing, setExecuting] = useState(false);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [activeTab, setActiveTab] = useState<"manual" | "natural">("manual");
  const [generatingSql, setGeneratingSql] = useState(false);
  const [nlError, setNlError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [agentInteractionOpen, setAgentInteractionOpen] = useState(false);
  const [agentResult, setAgentResult] = useState<QueryResult | null>(null);

  useEffect(() => {
    if (selectedDatabase) {
      loadMetadata();
    }
  }, [selectedDatabase]);

  const loadMetadata = async () => {
    if (!selectedDatabase) return;

    setLoading(true);
    try {
      const response = await apiClient.get<DatabaseMetadata>(
        `/api/v1/dbs/${selectedDatabase}`
      );
      setMetadata(response.data);
    } catch (error) {
      console.error("Failed to load metadata:", error);
      message.error("Failed to load database metadata");
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteQuery = async () => {
    const trimmed = sql.trim();
    if (!selectedDatabase || !trimmed) {
      message.warning("Please enter a SQL query");
      return;
    }

    // Check if input is a slash command
    if (isCommand(trimmed)) {
      handleCommand(trimmed);
      return;
    }

    setExecuting(true);
    try {
      const response = await apiClient.post<QueryResult>(
        `/api/v1/dbs/${selectedDatabase}/query`,
        { sql: trimmed }
      );
      setQueryResult(response.data);
      message.success(
        `Query executed - ${response.data.rowCount} rows in ${response.data.executionTimeMs}ms`
      );

      // Trigger Agent interaction for export prompt (only if results exist)
      if (response.data.rowCount > 0) {
        setAgentResult(response.data);
        // Delay to let the success message show first
        setTimeout(() => setAgentInteractionOpen(true), 500);
      }
    } catch (error: any) {
      message.error(error.response?.data?.detail || "Query execution failed");
      setQueryResult(null);
    } finally {
      setExecuting(false);
    }
  };

  const handleCommand = (input: string) => {
    const result = executeCommand(input);

    switch (result.action) {
      case "export":
        if (result.format) {
          handleExport(result.format);
        }
        break;

      case "export_interactive":
        showFormatModal();
        break;

      case "auto_export":
        if (result.sql && selectedDatabase) {
          const exportSql = result.sql;
          message.info(`执行自动导出: ${exportSql.slice(0, 50)}...`);
          setSql(exportSql);
          handleAutoExport(exportSql);
        }
        break;

      case "help":
        showHelpModal(result.message);
        break;

      case "error":
      case "unknown_command":
        message.warning(result.message);
        break;

      default:
        message.info(result.message);
    }
  };

  const handleCommandSubmit = (command: string) => {
    if (!command.startsWith("/")) {
      message.warning("命令必须以 / 开头，例如 /export csv");
      return;
    }
    handleCommand(command);
  };

  const [helpModal, setHelpModal] = useState<{ open: boolean; text: string }>({ open: false, text: "" });
  const [formatModal, setFormatModal] = useState(false);

  const showHelpModal = (text: string) => setHelpModal({ open: true, text });
  const showFormatModal = () => setFormatModal(true);

  const handleExport = async (format: string) => {
    if (!selectedDatabase) {
      message.warning("Please select a database first");
      return;
    }
    if (!queryResult || !queryResult.rows.length) {
      message.warning("Please execute a query first");
      return;
    }

    setExporting(true);
    try {
      const response = await apiClient.post<{
        filePath: string;
        format: string;
        rowCount: number;
        message: string;
        downloadUrl: string;
      }>(`/api/v1/dbs/${selectedDatabase}/export`, {
        format,
      });

      const { downloadUrl, rowCount } = response.data;
      const baseURL = apiClient.defaults.baseURL || "http://localhost:8000";
      const fullURL = `${baseURL}${downloadUrl}`;

      const link = document.createElement("a");
      link.href = fullURL;
      link.download = downloadUrl.split("file=")[1] || `export.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      message.success(`Exported ${rowCount} rows to ${format.toUpperCase()}`);
    } catch (error: any) {
      message.error(error.response?.data?.detail || `Export to ${format} failed`);
    } finally {
      setExporting(false);
    }
  };

  const handleAutoExport = async (autoSql: string) => {
    if (!selectedDatabase) {
      message.warning("Please select a database first");
      return;
    }

    setExecuting(true);
    try {
      const response = await apiClient.post<QueryResult>(
        `/api/v1/dbs/${selectedDatabase}/query`,
        { sql: autoSql }
      );
      setQueryResult(response.data);
      message.success(`Auto-query: ${response.data.rowCount} rows`);

      // Auto-export to CSV
      setExporting(true);
      const exportResponse = await apiClient.post<{
        filePath: string;
        format: string;
        rowCount: number;
        downloadUrl: string;
      }>(`/api/v1/dbs/${selectedDatabase}/export/auto`, {
        sql: autoSql,
        format: "csv",
      });

      const { downloadUrl, rowCount } = exportResponse.data;
      const baseURL = apiClient.defaults.baseURL || "http://localhost:8000";
      const fullURL = `${baseURL}${downloadUrl}`;

      const link = document.createElement("a");
      link.href = fullURL;
      link.download = downloadUrl.split("file=")[1] || "export.csv";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      message.success(`Auto-exported ${rowCount} rows to CSV`);
    } catch (error: any) {
      message.error(error.response?.data?.detail || "Auto-export failed");
    } finally {
      setExecuting(false);
      setExporting(false);
    }
  };

  const handleTableClick = (table: TableMetadata) => {
    setSql(`SELECT * FROM ${table.schemaName}.${table.name} LIMIT 100`);
  };

  const handleRefreshMetadata = async () => {
    if (!selectedDatabase) return;
    try {
      await apiClient.post(`/api/v1/dbs/${selectedDatabase}/refresh`);
      message.success("Metadata refreshed");
      loadMetadata();
    } catch (error: any) {
      message.error("Failed to refresh metadata");
    }
  };

  const handleGenerateSQL = async (prompt: string) => {
    if (!selectedDatabase) return;

    setGeneratingSql(true);
    setNlError(null);
    try {
      const response = await apiClient.post<{ sql: string; explanation: string }>(
        `/api/v1/dbs/${selectedDatabase}/query/natural`,
        { prompt }
      );
      setSql(response.data.sql);
      setActiveTab("manual"); // Switch to manual tab to show generated SQL
      message.success("SQL generated successfully! You can now edit and execute it.");
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || "Failed to generate SQL";
      setNlError(errorMsg);
      message.error(errorMsg);
    } finally {
      setGeneratingSql(false);
    }
  };

  const handleExportCSV = () => {
    if (!queryResult || queryResult.rows.length === 0) {
      message.warning("No data to export");
      return;
    }

    // Warn if result is large
    if (queryResult.rows.length > 10000) {
      Modal.confirm({
        title: "Large Dataset Warning",
        icon: <ExclamationCircleOutlined />,
        content: `You are about to export ${queryResult.rowCount.toLocaleString()} rows. This may take a while and consume memory. Continue?`,
        onOk: () => exportToCSV(),
      });
    } else {
      exportToCSV();
    }
  };

  const exportToCSV = () => {
    if (!queryResult) return;

    // Generate CSV content
    const headers = queryResult.columns.map((col) => col.name);
    const csvRows = [headers.join(",")];

    queryResult.rows.forEach((row) => {
      const values = headers.map((header) => {
        const value = row[header];
        // Handle null/undefined
        if (value === null || value === undefined) return "";
        // Escape quotes and wrap in quotes if contains comma or quote
        const stringValue = String(value);
        if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n")) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      });
      csvRows.push(values.join(","));
    });

    const csvContent = csvRows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
    link.href = URL.createObjectURL(blob);
    link.download = `${selectedDatabase}_${timestamp}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    message.success(`Exported ${queryResult.rowCount} rows to CSV`);
  };

  const handleExportJSON = () => {
    if (!queryResult || queryResult.rows.length === 0) {
      message.warning("No data to export");
      return;
    }

    // Warn if result is large
    if (queryResult.rows.length > 10000) {
      Modal.confirm({
        title: "Large Dataset Warning",
        icon: <ExclamationCircleOutlined />,
        content: `You are about to export ${queryResult.rowCount.toLocaleString()} rows. This may take a while and consume memory. Continue?`,
        onOk: () => exportToJSON(),
      });
    } else {
      exportToJSON();
    }
  };

  const exportToJSON = () => {
    if (!queryResult) return;

    const jsonContent = JSON.stringify(queryResult.rows, null, 2);
    const blob = new Blob([jsonContent], { type: "application/json;charset=utf-8;" });
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
    link.href = URL.createObjectURL(blob);
    link.download = `${selectedDatabase}_${timestamp}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    message.success(`Exported ${queryResult.rowCount} rows to JSON`);
  };

  const handleExportExcel = async () => {
    await handleExport("excel");
  };

  const tableColumns =
    queryResult?.columns.map((col) => ({
      title: col.name,
      dataIndex: col.name,
      key: col.name,
      ellipsis: true,
    })) || [];

  // No database selected state
  if (!selectedDatabase) {
    return (
      <div style={{ display: "flex", height: "100vh" }}>
        <DatabaseSidebar
          selectedDatabase={selectedDatabase}
          onSelectDatabase={setSelectedDatabase}
        />
        <div
          style={{
            marginLeft: 280,
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#F4EFEA",
          }}
        >
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Space direction="vertical" size={16}>
                <Title level={3} style={{ textTransform: "uppercase" }}>
                  NO DATABASE SELECTED
                </Title>
                <Text type="secondary" style={{ fontSize: 15 }}>
                  Add a database from the sidebar to get started
                </Text>
              </Space>
            }
          />
        </div>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div style={{ display: "flex", height: "100vh" }}>
        <DatabaseSidebar
          selectedDatabase={selectedDatabase}
          onSelectDatabase={setSelectedDatabase}
        />
        <div
          style={{
            marginLeft: 280,
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#F4EFEA",
          }}
        >
          <Spin size="large" />
        </div>
      </div>
    );
  }

  if (!metadata) {
    return null;
  }

  return (
    <div style={{ display: "flex", height: "100vh", background: "#F4EFEA" }}>
      {/* Database List Sidebar */}
      <DatabaseSidebar
        selectedDatabase={selectedDatabase}
        onSelectDatabase={setSelectedDatabase}
      />

      {/* Schema Sidebar - Full Height */}
      <div
        style={{
          width: 340,
          height: "100vh",
          background: "#FFFFFF",
          borderTop: "3px solid #000000",
          borderRight: "2px solid #000000",
          display: "flex",
          flexDirection: "column",
          position: "fixed",
          left: 280,
          top: 0,
        }}
      >
        {/* Database Name Top Bar - Sunbeam Yellow */}
        <div
          style={{
            padding: "16px 20px",
            background: "#FFDE00",
            borderBottom: "2px solid #000000",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            minHeight: 60,
          }}
        >
          <Space>
            <DatabaseOutlined style={{ fontSize: 20, fontWeight: 700 }} />
            <Title
              level={4}
              style={{
                margin: 0,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                fontSize: 18,
                fontWeight: 700,
              }}
            >
              {selectedDatabase}
            </Title>
          </Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={handleRefreshMetadata}
            style={{ borderWidth: 2, fontWeight: 700 }}
          >
            REFRESH
          </Button>
        </div>

        {/* Search Bar */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #E4D6C3" }}>
          <Input
            placeholder="Search tables, columns..."
            prefix={<SearchOutlined />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            allowClear
            size="middle"
          />
        </div>

        {/* Schema Tree - Fills Remaining Height */}
        <div style={{ flex: 1, overflow: "auto", padding: "16px" }}>
          <MetadataTree
            metadata={metadata}
            searchText={searchText}
            onTableClick={handleTableClick}
          />
        </div>
      </div>

      {/* Main Content Area */}
      <div
        style={{
          marginLeft: 620,
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          padding: "24px",
          height: "100vh",
        }}
      >
        {/* Compact Metrics Row */}
        <Row gutter={12} style={{ marginBottom: 16 }}>
          <Col span={6}>
            <div
              style={{
                padding: "12px",
                textAlign: "center",
                border: "2px solid #000000",
                borderRadius: 2,
                background: "#FFFFFF",
              }}
            >
              <Text
                type="secondary"
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  display: "block",
                  marginBottom: 4,
                }}
              >
                TABLES
              </Text>
              <Text style={{ fontSize: 24, fontWeight: 700 }}>
                {metadata.tables.length}
              </Text>
            </div>
          </Col>
          <Col span={6}>
            <div
              style={{
                padding: "12px",
                textAlign: "center",
                border: "2px solid #000000",
                borderRadius: 2,
                background: "#FFFFFF",
              }}
            >
              <Text
                type="secondary"
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  display: "block",
                  marginBottom: 4,
                }}
              >
                VIEWS
              </Text>
              <Text style={{ fontSize: 24, fontWeight: 700 }}>
                {metadata.views.length}
              </Text>
            </div>
          </Col>
          <Col span={6}>
            <div
              style={{
                padding: "12px",
                textAlign: "center",
                border: "2px solid #000000",
                borderRadius: 2,
                background: "#FFFFFF",
              }}
            >
              <Text
                type="secondary"
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  display: "block",
                  marginBottom: 4,
                }}
              >
                ROWS
              </Text>
              <Text
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: queryResult ? "#16AA98" : "#A1A1A1",
                }}
              >
                {queryResult?.rowCount || 0}
              </Text>
            </div>
          </Col>
          <Col span={6}>
            <div
              style={{
                padding: "12px",
                textAlign: "center",
                border: "2px solid #000000",
                borderRadius: 2,
                background: "#FFFFFF",
              }}
            >
              <Text
                type="secondary"
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  display: "block",
                  marginBottom: 4,
                }}
              >
                TIME
              </Text>
              <Text
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: queryResult ? "#16AA98" : "#A1A1A1",
                }}
              >
                {queryResult ? `${queryResult.executionTimeMs}ms` : "-"}
              </Text>
            </div>
          </Col>
        </Row>

        {/* Query Editor with Tabs */}
        <Card
          title={
            <Text
              strong
              style={{
                fontSize: 13,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              QUERY EDITOR
            </Text>
          }
          extra={
            activeTab === "manual" ? (
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={handleExecuteQuery}
                loading={executing}
                size="large"
                style={{
                  height: 40,
                  paddingLeft: 20,
                  paddingRight: 20,
                  fontWeight: 700,
                }}
              >
                EXECUTE
              </Button>
            ) : null
          }
          style={{ borderWidth: 2, borderColor: "#000000", marginBottom: 16 }}
        >
          <Tabs
            activeKey={activeTab}
            onChange={(key) => setActiveTab(key as "manual" | "natural")}
            items={[
              {
                key: "manual",
                label: (
                  <Text
                    strong
                    style={{
                      fontSize: 12,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    MANUAL SQL
                  </Text>
                ),
                children: (
                  <div>
                    <SqlEditor
                      value={sql}
                      onChange={(value) => setSql(value || "")}
                      height="180px"
                    />
                    <CommandBar
                      onExport={handleExport}
                      onAutoExecute={() => {
                        if (sql.trim().startsWith("/auto")) {
                          const autoSql = sql.trim().slice(5).trim();
                          if (autoSql) {
                            handleAutoExport(autoSql);
                          } else {
                            message.warning("请输入 /auto <SQL> 格式");
                          }
                        } else {
                          handleExecuteQuery();
                        }
                      }}
                      onCommandSubmit={handleCommandSubmit}
                      currentSql={sql}
                      hasQueryResult={!!queryResult && queryResult.rows.length > 0}
                    />
                  </div>
                ),
              },
              {
                key: "natural",
                label: (
                  <Text
                    strong
                    style={{
                      fontSize: 12,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    NATURAL LANGUAGE
                  </Text>
                ),
                children: (
                  <div style={{ padding: "12px 0" }}>
                    <NaturalLanguageInput
                      onGenerateSQL={handleGenerateSQL}
                      loading={generatingSql}
                      error={nlError}
                    />
                  </div>
                ),
              },
            ]}
            style={{
              marginTop: -16,
            }}
          />
        </Card>

        {/* Query Results */}
        {queryResult && (
          <Card
            title={
              <Space>
                <Text
                  strong
                  style={{
                    fontSize: 13,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  RESULTS
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  • {queryResult.rowCount} rows •{" "}
                  {queryResult.executionTimeMs}ms
                </Text>
              </Space>
            }
            extra={
              <Space size={8}>
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  onClick={handleExportCSV}
                  style={{ fontSize: 12, fontWeight: 700 }}
                >
                  EXPORT CSV
                </Button>
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  onClick={handleExportJSON}
                  style={{ fontSize: 12, fontWeight: 700 }}
                >
                  EXPORT JSON
                </Button>
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  loading={exporting}
                  onClick={handleExportExcel}
                  style={{ fontSize: 12, fontWeight: 700 }}
                >
                  EXPORT EXCEL
                </Button>
              </Space>
            }
            style={{ borderWidth: 2, borderColor: "#000000" }}
          >
            <Table
              columns={tableColumns}
              dataSource={queryResult.rows}
              rowKey={(_record, index) => index?.toString() || "0"}
              pagination={{
                pageSize: 50,
                showSizeChanger: true,
                showTotal: (total) => `Total ${total} rows`,
                pageSizeOptions: [10, 20, 50, 100],
              }}
              scroll={{ x: "max-content", y: "calc(100vh - 520px)" }}
              size="middle"
              bordered
            />
          </Card>
        )}
      </div>

      {/* Help Modal */}
      <Modal
        title="📤 命令帮助"
        open={helpModal.open}
        onCancel={() => setHelpModal({ open: false, text: "" })}
        footer={[
          <Button key="close" onClick={() => setHelpModal({ open: false, text: "" })}>
            关闭
          </Button>,
          <Button
            key="format"
            type="primary"
            onClick={() => {
              setHelpModal({ open: false, text: "" });
              showFormatModal();
            }}
          >
            选择导出格式
          </Button>,
        ]}
        width={560}
      >
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.8, fontFamily: "inherit" }}>
          {helpModal.text}
        </pre>
      </Modal>

      {/* Format Selection Modal */}
      <Modal
        title="选择导出格式"
        open={formatModal}
        onCancel={() => setFormatModal(false)}
        footer={null}
        width={420}
      >
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {queryResult ? "选择一种格式导出当前查询结果：" : "请先执行查询再导出"}
          </Text>
          <Button
            block
            icon={<DownloadOutlined />}
            onClick={() => {
              setFormatModal(false);
              handleExport("csv");
            }}
            disabled={!queryResult || queryResult.rows.length === 0}
            style={{ height: 48, justifyContent: "flex-start", paddingLeft: 16 }}
          >
            <Space>
              <Text strong>CSV</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>通用表格格式</Text>
            </Space>
          </Button>
          <Button
            block
            icon={<DownloadOutlined />}
            onClick={() => {
              setFormatModal(false);
              handleExport("json");
            }}
            disabled={!queryResult || queryResult.rows.length === 0}
            style={{ height: 48, justifyContent: "flex-start", paddingLeft: 16 }}
          >
            <Space>
              <Text strong>JSON</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>结构化数据</Text>
            </Space>
          </Button>
          <Button
            block
            icon={<DownloadOutlined />}
            onClick={() => {
              setFormatModal(false);
              handleExport("excel");
            }}
            disabled={!queryResult || queryResult.rows.length === 0}
            style={{ height: 48, justifyContent: "flex-start", paddingLeft: 16 }}
          >
            <Space>
              <Text strong>Excel (.xlsx)</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>带样式：微软雅黑、暗黄色标题</Text>
            </Space>
          </Button>
        </Space>
      </Modal>

      {/* Agent Interaction Modal */}
      {selectedDatabase && (
        <AgentInteraction
          databaseName={selectedDatabase}
          queryResult={agentResult}
          onExport={(format) => handleExport(format)}
          onClose={() => setAgentInteractionOpen(false)}
          externalOpen={agentInteractionOpen}
        />
      )}
    </div>
  );
};
