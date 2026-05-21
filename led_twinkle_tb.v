`timescale 1ns/1ns;

module led_twinkle_tb();

reg clk_tb;
reg rst_tb;
wire led_tb;

led_twinkle led_twinkle_inst_0(
    .clk(clk_tb),
    .rst(rst_tb),
    .led(led_tb)
);

always #10 clk_tb = ~clk_tb;

//initial begin ... end 是 仿真用的“初始过程块”。
//它的作用是：
//在仿真开始时（t=0）执行一次；
//里面通常写激励，比如复位拉低/拉高、输入变化、# 延时、$finish 结束仿真；
//执行完就结束，不会像 always 那样循环（除非你在里面自己写循环）。

initial begin
    rst_tb = 0;
    #201;
    rst_tb = 1;
    #2000000000;
    $stop;
end

