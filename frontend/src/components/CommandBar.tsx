/** Command bar component for slash command help and interaction. */

import React, { useState } from "react";
import { Modal, Button, Space, Typography, Tag, Tooltip, AutoComplete } from "antd";
import {
  QuestionCircleOutlined,
  DownloadOutlined,
  ThunderboltOutlined,
  FileTextOutlined,
  FileExcelOutlined,
  FileOutlined,
  SendOutlined,
  CodeOutlined,
} from "@ant-design/icons";
import { getHelpText } from "../services/commandParser";

const { Text } = Typography;

// Command suggestions for autocomplete
const COMMAND_SUGGESTIONS = [
  { value: "/export csv", label: "/export csv  - 导出CSV格式" },
  { value: "/export json", label: "/export json  - 导出JSON格式" },
  { value: "/export excel", label: "/export excel  - 导出Excel格式" },
  { value: "/export help", label: "/export help  - 查看帮助" },
  { value: "/export", label: "/export  - 交互式选择导出格式" },
  { value: "/auto", label: "/auto <SQL>  - 自动执行SQL并导出" },
];

interface CommandBarProps {
  onExport: (format: string) => void;
  onAutoExecute: () => void;
  onCommandSubmit: (command: string) => void;
  currentSql: string;
  hasQueryResult: boolean;
}

export const CommandBar: React.FC<CommandBarProps> = ({
  onExport,
  onAutoExecute,
  onCommandSubmit,
  currentSql,
  hasQueryResult,
}) => {
  const [helpModalOpen, setHelpModalOpen] = useState(false);
  const [formatModalOpen, setFormatModalOpen] = useState(false);
  const [commandInput, setCommandInput] = useState("");

  const showHelp = () => setHelpModalOpen(true);
  const showFormatSelect = () => setFormatModalOpen(true);

  const handleFormatChoice = (format: string) => {
    setFormatModalOpen(false);
    onExport(format);
  };

  const handleAutoExecute = () => {
    setHelpModalOpen(false);
    setFormatModalOpen(false);
    onAutoExecute();
  };

  const handleCommandSubmit = () => {
    const cmd = commandInput.trim();
    if (!cmd) return;
    onCommandSubmit(cmd);
    setCommandInput("");
  };

  const autoSqlPreview = currentSql.startsWith("/auto")
    ? currentSql.slice(5).trim()
    : currentSql.trim();

  return (
    <>
      {/* Command Input Bar - Enhanced Style */}
      <div
        style={{
          marginTop: 12,
          padding: "12px 16px",
          background: "#fff1b8",
          borderRadius: 8,
          border: "2px solid #d48806",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          boxShadow: "0 2px 8px rgba(212, 136, 6, 0.2)",
        }}
      >
        {/* Header Label */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: "#d48806",
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          <CodeOutlined style={{ fontSize: 18 }} />
          <span>斜杠命令</span>
          <Tag color="warning" style={{ marginLeft: 4 }}>/export csv /json /excel · /auto {"<SQL>"}</Tag>
        </div>
        
        {/* Input Row with Autocomplete */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <AutoComplete
            size="middle"
            placeholder="输入命令: /export csv · /export json · /export excel · /auto <SQL>"
            value={commandInput}
            onChange={(value) => setCommandInput(value)}
            onSelect={(value) => {
              setCommandInput(value);
              // Auto submit after selection
              setTimeout(() => handleCommandSubmit(), 100);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleCommandSubmit();
              }
            }}
            style={{ flex: 1, fontFamily: "monospace", height: 40 }}
            filterOption={(inputValue, option) =>
              option!.value!.toLowerCase().indexOf(inputValue.toLowerCase()) !== -1 ||
              option!.label!.toString().toLowerCase().indexOf(inputValue.toLowerCase()) !== -1
            }
            options={COMMAND_SUGGESTIONS}
            prefix={<Text type="secondary" style={{ fontSize: 14, color: "#d48806" }}>/</Text>}
          />
          <Button
            size="middle"
            type="primary"
            icon={<SendOutlined />}
            onClick={handleCommandSubmit}
            disabled={!commandInput.trim()}
            style={{ height: 40, fontWeight: 600 }}
          >
            执行
          </Button>
          <Button
            size="middle"
            icon={<QuestionCircleOutlined />}
            onClick={showHelp}
            style={{ height: 40 }}
          >
            帮助
          </Button>
        </div>
      </div>

      <Space size={4} style={{ marginTop: 8 }}>
        <Tooltip
          title={
            <div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                💡 Slash Commands
              </div>
              <div>/export csv · /export json · /export excel</div>
              <div>/auto {"<SQL>"} · /export help</div>
            </div>
          }
          placement="bottomLeft"
        >
          <Text
            type="secondary"
            style={{
              fontSize: 12,
              cursor: "pointer",
              userSelect: "none",
            }}
            onClick={showHelp}
          >
            <QuestionCircleOutlined /> 输入 <Tag>/export help</Tag> 查看命令
          </Text>
        </Tooltip>

        <Button
          size="small"
          icon={<QuestionCircleOutlined />}
          onClick={showHelp}
          style={{ fontSize: 11 }}
        >
          命令帮助
        </Button>

        <Button
          size="small"
          icon={<DownloadOutlined />}
          onClick={showFormatSelect}
          disabled={!hasQueryResult}
          style={{ fontSize: 11 }}
        >
          导出结果
        </Button>
      </Space>

      <Modal
        title={
          <Space>
            <FileTextOutlined />
            <span>📤 导出命令帮助</span>
          </Space>
        }
        open={helpModalOpen}
        onCancel={() => setHelpModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setHelpModalOpen(false)}>
            关闭
          </Button>,
          <Button
            key="export"
            type="primary"
            icon={<DownloadOutlined />}
            onClick={() => {
              setHelpModalOpen(false);
              showFormatSelect();
            }}
          >
            选择导出格式
          </Button>,
        ]}
        width={560}
      >
        <div style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.8 }}>
          {getHelpText()}
        </div>
        <div
          style={{
            marginTop: 16,
            padding: 12,
            background: "#f5f5f5",
            borderRadius: 6,
            border: "1px solid #e8e8e8",
          }}
        >
          <Text strong style={{ fontSize: 12 }}>
            快捷操作：
          </Text>
          <div style={{ marginTop: 8 }}>
            <Space wrap>
              <Button
                size="small"
                icon={<FileOutlined />}
                onClick={() => { setHelpModalOpen(false); onExport("csv"); }}
              >
                /export csv
              </Button>
              <Button
                size="small"
                icon={<FileTextOutlined />}
                onClick={() => { setHelpModalOpen(false); onExport("json"); }}
              >
                /export json
              </Button>
              <Button
                size="small"
                icon={<FileExcelOutlined />}
                onClick={() => { setHelpModalOpen(false); onExport("excel"); }}
              >
                /export excel
              </Button>
              <Button
                size="small"
                icon={<ThunderboltOutlined />}
                onClick={handleAutoExecute}
                disabled={!autoSqlPreview || autoSqlPreview.length === 0}
              >
                /auto {autoSqlPreview ? autoSqlPreview.slice(0, 40) + (autoSqlPreview.length > 40 ? "..." : "") : "<SQL>"}
              </Button>
            </Space>
          </div>
        </div>
      </Modal>

      <Modal
        title={
          <Space>
            <DownloadOutlined />
            <span>选择导出格式</span>
          </Space>
        }
        open={formatModalOpen}
        onCancel={() => setFormatModalOpen(false)}
        footer={null}
        width={420}
      >
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {hasQueryResult
              ? "选择一种格式导出当前查询结果："
              : "请先执行查询再导出"}
          </Text>
          <Button
            block
            icon={<FileOutlined />}
            onClick={() => handleFormatChoice("csv")}
            disabled={!hasQueryResult}
            style={{ height: 48, justifyContent: "flex-start", paddingLeft: 16 }}
          >
            <Space>
              <Text strong>CSV</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                通用表格格式，Excel兼容
              </Text>
            </Space>
          </Button>
          <Button
            block
            icon={<FileTextOutlined />}
            onClick={() => handleFormatChoice("json")}
            disabled={!hasQueryResult}
            style={{ height: 48, justifyContent: "flex-start", paddingLeft: 16 }}
          >
            <Space>
              <Text strong>JSON</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                结构化数据，保留嵌套信息
              </Text>
            </Space>
          </Button>
          <Button
            block
            icon={<FileExcelOutlined />}
            onClick={() => handleFormatChoice("excel")}
            disabled={!hasQueryResult}
            style={{ height: 48, justifyContent: "flex-start", paddingLeft: 16 }}
          >
            <Space>
              <Text strong>Excel (.xlsx)</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                带样式：微软雅黑、暗黄色标题、边框
              </Text>
            </Space>
          </Button>
        </Space>
      </Modal>
    </>
  );
};
