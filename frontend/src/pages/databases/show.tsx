/** Database detail page with integrated query interface. */

import { useEffect, useState } from "react";
import { Show, RefreshButton } from "@refinedev/antd";
import { useParams } from "react-router-dom";
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
  Statistic,
  Typography,
  Modal
} from "antd";
import {
  PlayCircleOutlined,
  SearchOutlined,
  TableOutlined,
  DatabaseOutlined,
  DownloadOutlined
} from "@ant-design/icons";
import { apiClient } from "../../services/api";
import { DatabaseMetadata, TableMetadata } from "../../types/metadata";
import { MetadataTree } from "../../components/MetadataTree";
import { SqlEditor } from "../../components/SqlEditor";
import { CommandBar } from "../../components/CommandBar";
import { AgentInteraction } from "../../components/AgentInteraction";
import { executeCommand, isCommand } from "../../services/commandParser";

const { Text } = Typography;

interface QueryResult {
  columns: Array<{ name: string; dataType: string }>;
  rows: Array<Record<string, any>>;
  rowCount: number;
  executionTimeMs: number;
  sql: string;
}

export const DatabaseShow: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [metadata, setMetadata] = useState<DatabaseMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [sql, setSql] = useState("SELECT * FROM ");
  const [executing, setExecuting] = useState(false);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [helpModal, setHelpModal] = useState<{ open: boolean; text: string }>({ open: false, text: "" });
  const [formatModal, setFormatModal] = useState(false);
  const [agentInteractionOpen, setAgentInteractionOpen] = useState(false);
  const [agentResult, setAgentResult] = useState<QueryResult | null>(null);

  useEffect(() => {
    loadMetadata(false);
  }, [id]);

  const loadMetadata = async (forceRefresh: boolean) => {
    if (!id) return;

    setLoading(true);
    try {
      const response = await apiClient.get<DatabaseMetadata>(
        `/api/v1/dbs/${id}${forceRefresh ? "?refresh=true" : ""}`
      );
      setMetadata(response.data);
    } catch (error) {
      console.error("Failed to load metadata:", error);
      message.error("Failed to load database metadata");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadMetadata(true);
  };

  const handleExecuteQuery = async () => {
    const trimmed = sql.trim();
    if (!id || !trimmed) {
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
        `/api/v1/dbs/${id}/query`,
        { sql: trimmed }
      );
      setQueryResult(response.data);
      message.success(`Query executed successfully - ${response.data.rowCount} rows in ${response.data.executionTimeMs}ms`);

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
        setFormatModal(true);
        break;

      case "auto_export":
        if (result.sql && id) {
          const exportSql = result.sql;
          message.info(`执行自动导出: ${exportSql.slice(0, 50)}...`);
          setSql(exportSql);
          handleAutoExport(exportSql);
        }
        break;

      case "help":
        setHelpModal({ open: true, text: result.message });
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

  const handleAutoExport = async (autoSql: string) => {
    if (!id) {
      message.warning("请先选择数据库");
      return;
    }

    setExecuting(true);
    try {
      const response = await apiClient.post<QueryResult>(
        `/api/v1/dbs/${id}/query`,
        { sql: autoSql }
      );
      setQueryResult(response.data);
      message.success(`Auto-query: ${response.data.rowCount} rows`);

      // Auto-export to CSV
      const exportResponse = await apiClient.post<{
        filePath: string;
        format: string;
        rowCount: number;
        downloadUrl: string;
      }>(`/api/v1/dbs/${id}/export/auto`, {
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
    }
  };

  const handleTableClick = (table: TableMetadata) => {
    setSql(`SELECT * FROM ${table.schemaName}.${table.name} LIMIT 100`);
  };

  const handleExport = async (format: string) => {
    if (!id) {
      message.warning("请先选择数据库");
      return;
    }
    if (!queryResult || !queryResult.rows.length) {
      message.warning("请先执行查询");
      return;
    }

    setExporting(format);
    try {
      const response = await apiClient.post<{
        filePath: string;
        format: string;
        rowCount: number;
        message: string;
        downloadUrl: string;
      }>(`/api/v1/dbs/${id}/export`, {
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
      setExporting(null);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "50px" }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!metadata) {
    return <div>Failed to load metadata</div>;
  }

  const tableColumns = queryResult?.columns.map((col) => ({
    title: col.name,
    dataIndex: col.name,
    key: col.name,
    ellipsis: true,
  })) || [];

  return (
    <Show
      title={
        <Space>
          <DatabaseOutlined />
          <Text strong style={{ fontSize: 20 }}>
            {metadata.databaseName.toUpperCase()}
          </Text>
        </Space>
      }
      headerButtons={({ defaultButtons }) => (
        <>
          {defaultButtons}
          <RefreshButton onClick={handleRefresh} loading={refreshing} />
        </>
      )}
    >
      <Row gutter={24} style={{ marginBottom: 24 }}>
        <Col span={8}>
          <Card style={{ textAlign: "center", borderWidth: 2 }}>
            <Statistic
              title="TABLES"
              value={metadata.tables.length}
              prefix={<TableOutlined style={{ fontSize: 24 }} />}
              valueStyle={{ fontSize: 36, fontWeight: 700 }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card style={{ textAlign: "center", borderWidth: 2 }}>
            <Statistic
              title="VIEWS"
              value={metadata.views.length}
              prefix={<DatabaseOutlined style={{ fontSize: 24 }} />}
              valueStyle={{ fontSize: 36, fontWeight: 700 }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card style={{ textAlign: "center", borderWidth: 2 }}>
            <Statistic
              title="RESULT ROWS"
              value={queryResult?.rowCount || 0}
              valueStyle={{ fontSize: 36, fontWeight: 700, color: queryResult ? "#16AA98" : "#A1A1A1" }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={24}>
        <Col span={6}>
          <Card
            title="SCHEMA"
            extra={
              <Input
                placeholder="Search..."
                prefix={<SearchOutlined />}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                allowClear
                size="middle"
                style={{ width: 140 }}
              />
            }
            style={{
              height: "calc(100vh - 340px)",
              borderWidth: 2,
            }}
            bodyStyle={{
              height: "calc(100% - 57px)",
              overflow: "auto",
              padding: "16px"
            }}
          >
            <MetadataTree
              metadata={metadata}
              searchText={searchText}
              onTableClick={handleTableClick}
            />
          </Card>
        </Col>

        <Col span={18}>
          <Space direction="vertical" style={{ width: "100%" }} size={24}>
            <Card
              title={
                <Space>
                  <Text strong style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    SQL EDITOR
                  </Text>
                  {queryResult && (
                    <Text type="secondary" style={{ fontSize: 12, textTransform: "none" }}>
                      • Last executed: {new Date().toLocaleTimeString()}
                    </Text>
                  )}
                </Space>
              }
              extra={
                <Button
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  onClick={handleExecuteQuery}
                  loading={executing}
                  size="large"
                  style={{
                    height: 44,
                    paddingLeft: 24,
                    paddingRight: 24,
                    fontWeight: 700,
                  }}
                >
                  EXECUTE
                </Button>
              }
              style={{ borderWidth: 2 }}
            >
              <SqlEditor
                value={sql}
                onChange={(value) => setSql(value || "")}
                height="240px"
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
            </Card>

            {queryResult && (
              <Card
                title={
                  <Space>
                    <Text strong style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      RESULTS
                    </Text>
                    <Text type="secondary">
                      • {queryResult.rowCount} rows • {queryResult.executionTimeMs}ms
                    </Text>
                  </Space>
                }
                extra={
                  <Space>
                    <Button
                      icon={<DownloadOutlined />}
                      size="middle"
                      loading={exporting === "csv"}
                      onClick={() => handleExport("csv")}
                    >
                      EXPORT CSV
                    </Button>
                    <Button
                      icon={<DownloadOutlined />}
                      size="middle"
                      loading={exporting === "json"}
                      onClick={() => handleExport("json")}
                    >
                      EXPORT JSON
                    </Button>
                    <Button
                      icon={<DownloadOutlined />}
                      size="middle"
                      loading={exporting === "excel"}
                      onClick={() => handleExport("excel")}
                    >
                      EXPORT EXCEL
                    </Button>
                  </Space>
                }
                style={{ borderWidth: 2 }}
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
                  scroll={{ x: "max-content", y: 450 }}
                  size="middle"
                  bordered
                />
              </Card>
            )}
          </Space>
        </Col>
      </Row>

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
              setFormatModal(true);
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
      {id && (
        <AgentInteraction
          databaseName={id}
          queryResult={agentResult}
          onExport={(format) => handleExport(format)}
          onClose={() => setAgentInteractionOpen(false)}
          externalOpen={agentInteractionOpen}
        />
      )}
    </Show>
  );
};
