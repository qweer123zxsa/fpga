module led_3_8(input wire clk, input wire rst, output wire [7:0]led);


reg [24:0] cnt;

parameter N = 25000000-1;
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


reg [2:0] cnt_2;
always @(posedge clk or negedge rst) begin
    if(!rst) begin
        cnt_2 <=0;
    end
    else if(cnt >= N) begin
        cnt_2 <= cnt_2+1'd1;
    end
end

decode_3_8 decode_3_8_inst_0(
    .A0(cnt_2[0]),
    .A1(cnt_2[1]),
    .A2(cnt_2[2]),
    .Y0(led[0]),
    .Y1(led[1]),
    .Y2(led[2]),
    .Y3(led[3]),
    .Y4(led[4]),
    .Y5(led[5]),
    .Y6(led[6]),
    .Y7(led[7])
);




endmodule