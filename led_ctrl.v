module led_ctrl(input wire clk, input wire rst, output reg led);


reg [25:0] cnt;

parameter N = 50000000-1;
always @(posedge clk or negedge rst) begin
    if(!rst) begin
        cnt <=0;
    end
    else if(cnt >= N) begin
        cnt <=0;
    end
    else begin
        cnt <= cnt+1'd1;   
    end
end



always @(posedge clk or negedge rst) begin
    if(!rst) begin
        cnt_2 <=0;
    end
    else if(cnt >= N/4) begin
        led <= 1;
    end
    else if(cnt==0) begin
        led <= 0;
    end
end

endmodule