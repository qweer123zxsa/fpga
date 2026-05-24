module uart_8n1 #(
    parameter integer CLK_FREQ_HZ = 50000000,
    parameter integer BAUD_RATE   = 115200
)(
    input  wire       clk,
    input  wire       rst_n,
    input  wire       rx,
    output wire       tx,

    input  wire [7:0] tx_data,
    input  wire       tx_start,
    output wire       tx_busy,
    output wire       tx_done,

    output wire [7:0] rx_data,
    output wire       rx_valid,
    output wire       rx_busy
);

    uart_tx #(
        .CLK_FREQ_HZ(CLK_FREQ_HZ),
        .BAUD_RATE  (BAUD_RATE)
    ) u_uart_tx (
        .clk     (clk),
        .rst_n   (rst_n),
        .tx_data (tx_data),
        .tx_start(tx_start),
        .tx      (tx),
        .tx_busy (tx_busy),
        .tx_done (tx_done)
    );

    uart_rx #(
        .CLK_FREQ_HZ(CLK_FREQ_HZ),
        .BAUD_RATE  (BAUD_RATE)
    ) u_uart_rx (
        .clk     (clk),
        .rst_n   (rst_n),
        .rx      (rx),
        .rx_data (rx_data),
        .rx_valid(rx_valid),
        .rx_busy (rx_busy)
    );

endmodule

module uart_tx #(
    parameter integer CLK_FREQ_HZ = 50000000,
    parameter integer BAUD_RATE   = 115200
)(
    input  wire       clk,
    input  wire       rst_n,
    input  wire [7:0] tx_data,
    input  wire       tx_start,
    output wire       tx,
    output reg        tx_busy,
    output reg        tx_done
);

    localparam integer BAUD_DIV = CLK_FREQ_HZ / BAUD_RATE;
    localparam integer CNT_W    = clog2(BAUD_DIV);

    reg [CNT_W-1:0] baud_cnt;
    reg [3:0]       bit_cnt;
    reg [9:0]       tx_shift;

    assign tx = tx_busy ? tx_shift[0] : 1'b1;

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            baud_cnt <= {CNT_W{1'b0}};
            bit_cnt  <= 4'd0;
            tx_shift <= 10'h3FF;
            tx_busy  <= 1'b0;
            tx_done  <= 1'b0;
        end else begin
            tx_done <= 1'b0;

            if (!tx_busy) begin
                if (tx_start) begin
                    tx_busy  <= 1'b1;
                    baud_cnt <= {CNT_W{1'b0}};
                    bit_cnt  <= 4'd0;
                    tx_shift <= {1'b1, tx_data, 1'b0}; // stop + data + start
                end
            end else begin
                if (baud_cnt == BAUD_DIV - 1) begin
                    baud_cnt <= {CNT_W{1'b0}};

                    if (bit_cnt == 4'd9) begin
                        tx_busy <= 1'b0;
                        tx_done <= 1'b1;
                    end else begin
                        bit_cnt  <= bit_cnt + 1'b1;
                        tx_shift <= {1'b1, tx_shift[9:1]};
                    end
                end else begin
                    baud_cnt <= baud_cnt + 1'b1;
                end
            end
        end
    end

    function integer clog2;
        input integer value;
        integer i;
        begin
            value = value - 1;
            for (i = 0; value > 0; i = i + 1)
                value = value >> 1;
            clog2 = (i == 0) ? 1 : i;
        end
    endfunction

endmodule

module uart_rx #(
    parameter integer CLK_FREQ_HZ = 50000000,
    parameter integer BAUD_RATE   = 115200
)(
    input  wire       clk,
    input  wire       rst_n,
    input  wire       rx,
    output reg  [7:0] rx_data,
    output reg        rx_valid,
    output wire       rx_busy
);

    localparam integer BAUD_DIV  = CLK_FREQ_HZ / BAUD_RATE;
    localparam integer HALF_BAUD = BAUD_DIV / 2;
    localparam integer CNT_W     = clog2(BAUD_DIV);

    localparam [1:0] S_IDLE  = 2'd0;
    localparam [1:0] S_START = 2'd1;
    localparam [1:0] S_DATA  = 2'd2;
    localparam [1:0] S_STOP  = 2'd3;

    reg [1:0]       state;
    reg [CNT_W-1:0] baud_cnt;
    reg [2:0]       bit_cnt;
    reg [7:0]       rx_shift;

    reg rx_sync0;
    reg rx_sync1;

    assign rx_busy = (state != S_IDLE);

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            rx_sync0 <= 1'b1;
            rx_sync1 <= 1'b1;
        end else begin
            rx_sync0 <= rx;
            rx_sync1 <= rx_sync0;
        end
    end

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            state    <= S_IDLE;
            baud_cnt <= {CNT_W{1'b0}};
            bit_cnt  <= 3'd0;
            rx_shift <= 8'd0;
            rx_data  <= 8'd0;
            rx_valid <= 1'b0;
        end else begin
            rx_valid <= 1'b0;

            case (state)
                S_IDLE: begin
                    baud_cnt <= {CNT_W{1'b0}};
                    bit_cnt  <= 3'd0;
                    if (rx_sync1 == 1'b0)
                        state <= S_START;
                end

                S_START: begin
                    if (baud_cnt == HALF_BAUD - 1) begin
                        baud_cnt <= {CNT_W{1'b0}};
                        if (rx_sync1 == 1'b0)
                            state <= S_DATA;
                        else
                            state <= S_IDLE;
                    end else begin
                        baud_cnt <= baud_cnt + 1'b1;
                    end
                end

                S_DATA: begin
                    if (baud_cnt == BAUD_DIV - 1) begin
                        baud_cnt <= {CNT_W{1'b0}};
                        rx_shift[bit_cnt] <= rx_sync1;
                        if (bit_cnt == 3'd7) begin
                            bit_cnt <= 3'd0;
                            state   <= S_STOP;
                        end else begin
                            bit_cnt <= bit_cnt + 1'b1;
                        end
                    end else begin
                        baud_cnt <= baud_cnt + 1'b1;
                    end
                end

                S_STOP: begin
                    if (baud_cnt == BAUD_DIV - 1) begin
                        baud_cnt <= {CNT_W{1'b0}};
                        state    <= S_IDLE;
                        if (rx_sync1 == 1'b1) begin
                            rx_data  <= rx_shift;
                            rx_valid <= 1'b1;
                        end
                    end else begin
                        baud_cnt <= baud_cnt + 1'b1;
                    end
                end

                default: begin
                    state <= S_IDLE;
                end
            endcase
        end
    end

    function integer clog2;
        input integer value;
        integer i;
        begin
            value = value - 1;
            for (i = 0; value > 0; i = i + 1)
                value = value >> 1;
            clog2 = (i == 0) ? 1 : i;
        end
    endfunction

endmodule

