module led_twinkle(input wire clk, input wire rst, output wire led);


reg [24:0] cnt;

always @(posedge clk or negedge rst) begin
    if(!rst) begin
        cnt <=0;
    end
    else if(cnt >= 25'd24999999) begin
        cnt <=0;
    end
    else begin
        cnt <= cnt+1'd1;   
    end
end

assign led = cnt[24];



endmodule




